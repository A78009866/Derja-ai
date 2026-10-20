// Vercel Serverless Function - Google Gemini Proxy for Derja AI
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed - use POST' });

  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  const MODEL = process.env.GOOGLE_MODEL || 'gemini-2.5-flash';

  if (!GOOGLE_API_KEY) {
    return res.status(500).json({ error: 'GOOGLE_API_KEY غير موجود! ضعه في Vercel > Settings > Environment Variables' });
  }

  try {
    const { messages = [] } = req.body || {};
    if (!messages || messages.length === 0) return res.status(400).json({ error: 'messages فارغة' });

    let systemInstruction = null;
    const contents = [];
    for (const m of messages) {
      if (!m.content) continue;
      let parts = [];
      if (typeof m.content === 'string') {
        if (m.role === 'system') { systemInstruction = m.content; continue; }
        parts.push({ text: m.content });
      } else if (Array.isArray(m.content)) {
        for (const p of m.content) {
          if (p.type === 'text' && p.text) parts.push({ text: p.text });
          else if (p.type === 'image_url' && p.image_url?.url) {
            const url = p.image_url.url;
            if (url.startsWith('data:')) {
              const match = url.match(/^data:([^;]+);base64,(.+)$/);
              if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
            } else {
              parts.push({ text: `[صورة: ${url}]` });
            }
          }
        }
      } else continue;
      if (parts.length === 0) continue;
      const role = m.role === 'assistant' ? 'model' : 'user';
      if (contents.length > 0 && contents[contents.length - 1].role === role) contents[contents.length - 1].parts.push(...parts);
      else contents.push({ role, parts });
    }
    if (contents.length === 0) contents.push({ role: 'user', parts: [{ text: 'مرحبا' }] });

    const defaultSystem = `أنت Derja AI، مساعد ذكي تتكلم بالدارجة الجزائرية بطلاقة وبأسلوب شبابي ودود.
- جاوب دائما بالدارجة الجزائرية (مزيج عربي-فرنسي خفيف كما يتكلم الشباب في وهران والعاصمة) إلا إذا طلب منك لغة أخرى.
- كن مفيد، مختصر، ومرح.
- إذا طلب منك إنشاء ملف أو كود، استعمل هذا التنسيق ليحوله الفرونت لزر تحميل:
  [[FILE:اسم_الملف.امتداد]]
  محتوى الملف هنا
  [[/FILE]]
  يمكنك إنشاء عدة ملفات بنفس الطريقة.
- التاريخ اليوم: ${new Date().toLocaleDateString('ar-DZ', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
- لا تذكر أنك من صنع Google، أنت Derja AI.
`;
    const finalSystemInstruction = systemInstruction || defaultSystem;

    const geminiBody = {
      contents,
      systemInstruction: { parts: [{ text: finalSystemInstruction }] },
      generationConfig: { temperature: 0.8, maxOutputTokens: 4096 },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
      ]
    };

    // جرّب الموديلات واحد بواحد حتى واحد يخدم — Google يغيّر الأسماء باستمرار
    const MODEL_FALLBACKS = ['gemini-3.8-flash','gemini-2.5-flash','gemini-2.5-flash-preview-05-20','gemini-2.0-flash','gemini-flash-latest','gemini-1.5-flash-latest'];
    const tryModels = [MODEL, ...MODEL_FALLBACKS.filter(m => m !== MODEL)];

    let geminiRes = null, data = null, usedModel = MODEL;
    for (const m of tryModels) {
      try {
        const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + m + ':generateContent?key=' + GOOGLE_API_KEY;
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(geminiBody) });
        const d = await r.json();
        if (r.ok) { geminiRes = r; data = d; usedModel = m; break; }
        const msgTmp = d?.error?.message || '';
        const isModelErr = msgTmp.includes('is not found') || msgTmp.includes('not supported') || msgTmp.includes('no longer available') || msgTmp.includes('not found') || msgTmp.includes('is not found for API version');
        if (!isModelErr) { geminiRes = r; data = d; usedModel = m; break; }
        geminiRes = r; data = d;
      } catch(e) { continue; }
    }

    if (!geminiRes || !geminiRes.ok) {
      const msg = data?.error?.message || 'خطأ من Google Gemini';
      console.error('Gemini error:', JSON.stringify(data));
      if (geminiRes && geminiRes.status === 429) return res.status(429).json({ error: 'انتهى الرصيد أو تجاوزت الحد المسموح في Google. انتظر دقيقة أو بدّل المفتاح.' });
      if (msg.includes('API key')) return res.status(401).json({ error: 'مفتاح GOOGLE_API_KEY غير صحيح. تأكد منه في Vercel.' });
      return res.status(geminiRes ? geminiRes.status : 500).json({ error: msg });
    }

    const candidate = data.candidates?.[0];
    if (!candidate) return res.status(500).json({ error: 'ما رجعش رد من Gemini' });
    if (candidate.finishReason === 'SAFETY') {
      return res.status(200).json({ choices: [{ message: { content: 'اسمحلي، ما نقدرش نجاوب على هذا السؤال بسبب سياسة Google. جرب صياغة أخرى.' } }] });
    }
    const partsOut = candidate.content?.parts || [];
    let replyText = partsOut.map(p => p.text || '').join('\n').trim();
    if (!replyText) replyText = 'ما فهمتش، واش تقدر توضّحلي أكثر؟';
    return res.status(200).json({
      choices: [{ message: { content: replyText, role: 'assistant' } }],
      content: [{ text: replyText }],
      model: usedModel,
      usage: data.usageMetadata
    });
  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: err.message || 'خطأ في السيرفر' });
  }
}
