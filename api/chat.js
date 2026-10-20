// Vercel Serverless Function - Google Gemini Proxy for Derja AI
// ضع مفتاح Google في Vercel Environment Variables باسم GOOGLE_API_KEY

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed - use POST' });
  }

  // 1. قراءة المفتاح من متغيرات البيئة
  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  const MODEL = process.env.GOOGLE_MODEL || 'gemini-2.0-flash'; // موديلات متاحة: gemini-2.0-flash, gemini-2.5-flash, gemini-2.0-flash-lite

  if (!GOOGLE_API_KEY) {
    return res.status(500).json({ 
      error: 'GOOGLE_API_KEY غير موجود! ضعه في Vercel > Settings > Environment Variables' 
    });
  }

  try {
    const { messages = [] } = req.body || {};

    if (!messages || messages.length === 0) {
      return res.status(400).json({ error: 'messages فارغة' });
    }

    // 2. تحويل رسائل الفرونت (OpenAI format) إلى صيغة Gemini
    // الفرونت يرسل: {role: 'user'|'assistant', content: string | [{type:'text', text}, {type:'image_url', image_url:{url}}]}

    let systemInstruction = null;
    const contents = [];

    for (const m of messages) {
      // تجاهل رسائل النظام الفارغة
      if (!m.content) continue;

      // استخرج النص والصور
      let parts = [];

      if (typeof m.content === 'string') {
        if (m.role === 'system') {
          // Gemini يفصل system prompt
          systemInstruction = m.content;
          continue;
        }
        parts.push({ text: m.content });
      } else if (Array.isArray(m.content)) {
        for (const p of m.content) {
          if (p.type === 'text' && p.text) {
            parts.push({ text: p.text });
          } else if (p.type === 'image_url' && p.image_url?.url) {
            const url = p.image_url.url;
            // data:image/png;base64,...
            if (url.startsWith('data:')) {
              const match = url.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                const mimeType = match[1];
                const data = match[2];
                parts.push({
                  inlineData: { mimeType, data }
                });
              }
            } else {
              // رابط عادي - Gemini لا يدعم URL مباشرة، نحوله لنص
              parts.push({ text: `[صورة: ${url}]` });
            }
          }
        }
      } else {
        continue;
      }

      if (parts.length === 0) continue;

      // Gemini يستخدم user / model فقط
      const role = m.role === 'assistant' ? 'model' : 'user';

      // دمج الرسائل المتتالية من نفس الدور (Gemini يرفض تكرار نفس الدور)
      if (contents.length > 0 && contents[contents.length - 1].role === role) {
        contents[contents.length - 1].parts.push(...parts);
      } else {
        contents.push({ role, parts });
      }
    }

    // إذا لا يوجد contents (مثلا فقط system)
    if (contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: 'مرحبا' }] });
    }

    // 3. إعداد systemInstruction الافتراضي لـ Derja AI إذا لم يرسل الفرونت واحد
    // يمكنك تعديل هذه الشخصية كما تريد
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

    // 4. بناء طلب Gemini
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GOOGLE_API_KEY}`;
    // لو فشل الموديل، سنحاول تلقائيا مع موديل بديل في الأسفل

    const geminiBody = {
      contents: contents,
      systemInstruction: {
        parts: [{ text: finalSystemInstruction }]
      },
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 4096,
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
      ]
    };

    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody)
    });

    const data = await geminiRes.json();

    // 5. معالجة الأخطاء من Google — مع fallback تلقائي للموديل
    if (!geminiRes.ok) {
      const msg = data?.error?.message || 'خطأ من Google Gemini';
      // إذا الموديل غير موجود، جرّب موديلات بديلة تلقائيا
      const isModelNotFound = msg.includes('is not found') || msg.includes('not supported') || msg.includes('not found');
      if (isModelNotFound && !req._retried) {
        const fallbacks = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.0-flash-lite', 'gemini-flash-latest'];
        for (const fb of fallbacks) {
          if (fb === MODEL) continue;
          try {
            const fbUrl = `https://generativelanguage.googleapis.com/v1beta/models/${fb}:generateContent?key=${GOOGLE_API_KEY}`;
            const fbRes = await fetch(fbUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(geminiBody) });
            const fbData = await fbRes.json();
            if (fbRes.ok && fbData.candidates?.[0]) {
              const partsOut2 = fbData.candidates[0].content?.parts || [];
              let replyText2 = partsOut2.map(p => p.text || '').join('\n').trim() || 'ما فهمتش، واش تقدر توضّحلي أكثر؟';
              return res.status(200).json({ choices: [{ message: { content: replyText2, role: 'assistant' } }], content: [{ text: replyText2 }], model: fb, usage: fbData.usageMetadata });
            }
          } catch(e) {}
        }
      }
      console.error('Gemini error:', JSON.stringify(data));
      if (geminiRes.status === 429) {
        return res.status(429).json({ error: 'انتهى الرصيد أو تجاوزت الحد المسموح في Google. انتظر دقيقة أو بدّل المفتاح.' });
      }
      if (msg.includes('API key')) {
        return res.status(401).json({ error: 'مفتاح GOOGLE_API_KEY غير صحيح. تأكد منه في Vercel.' });
      }
      return res.status(geminiRes.status).json({ error: msg });
    }

    // 6. استخراج النص
    const candidate = data.candidates?.[0];
    if (!candidate) {
      return res.status(500).json({ error: 'ما رجعش رد من Gemini' });
    }

    // إذا تم حجب الرد بسبب Safety
    if (candidate.finishReason === 'SAFETY') {
      return res.status(200).json({
        choices: [{ message: { content: 'اسمحلي، ما نقدرش نجاوب على هذا السؤال بسبب سياسة Google. جرب صياغة أخرى.' } }]
      });
    }

    const partsOut = candidate.content?.parts || [];
    let replyText = partsOut.map(p => p.text || '').join('\n').trim();

    if (!replyText) {
      replyText = 'ما فهمتش، واش تقدر توضّحلي أكثر؟';
    }

    // 7. إرجاع بصيغة يفهمها الفرونت (OpenAI compatible)
    return res.status(200).json({
      choices: [
        { message: { content: replyText, role: 'assistant' } }
      ],
      // للتوافق مع الكود القديم أيضا
      content: [{ text: replyText }],
      model: MODEL,
      usage: data.usageMetadata
    });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: err.message || 'خطأ في السيرفر' });
  }
}
