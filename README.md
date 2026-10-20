# Derja AI - نسخة Google Gemini جاهزة للنشر على Vercel

هذه نسخة كاملة من مشروع Derja AI بعد تحويل الـ API إلى **Google Gemini** بدل الـ API القديم.

## 📁 محتويات المشروع
```
derja-ai-vercel/
├── index.html          → الفرونت كامل (HTML+CSS+JS في ملف واحد)
├── api/
│   └── chat.js         → الباك-إند الجديد (Vercel Function يتصل بـ Google Gemini)
├── static/
│   ├── logo.png
│   ├── intro.mp4
│   └── send.png
├── vercel.json         → إعدادات Vercel
├── package.json
└── .env.example
```

## 🔑 الخطوة 1: جيب مفتاح Google Gemini (مجاني)

1. روح لـ: https://aistudio.google.com/app/apikey
2. سجّل بـ Gmail تاعك
3. اضغط **Create API Key** → انسخ المفتاح (يبدأ بـ `AIza...`)

> مجاني: 60 طلب / دقيقة، و 1500 طلب / يوم في الخطة المجانية

إذا تريد موديل أقوى يمكنك اختيار `gemini-1.5-pro` أو `gemini-2.0-flash`

## 🚀 الخطوة 2: النشر على Vercel (فارسال)

### الطريقة A: عن طريق GitHub (الأسهل)
1. أنشئ Repo جديد في GitHub وارفعه
2. ادخل https://vercel.com → **Add New Project** → اختر الـ Repo
3. قبل الضغط Deploy روح لـ **Environment Variables** وأضف:

| Name | Value |
|------|-------|
| `GOOGLE_API_KEY` | `AIza...` تاعك |
| `GOOGLE_MODEL` | `gemini-1.5-flash` (اختياري) |

4. اضغط **Deploy** → مبروك موقعك جاهز!

### الطريقة B: رفع مباشر
```bash
npm i -g vercel
vercel login
vercel --prod
# سيطلب منك وضع المتغيرات
```

## ⚙️ أين تضع الـ API Key ؟ (مهم جدا)

**لا تضعه في الكود!** ضعه في لوحة تحكم Vercel:

```
Vercel Dashboard → مشروعك → Settings → Environment Variables → Add New
Name: GOOGLE_API_KEY
Value: AIzaSyXXXXXXXX...
Environments: Production + Preview + Development (علّمهم كلهم)
→ Save → Redeploy
```

**للتجربة المحلية فقط:** انسخ `.env.example` إلى `.env.local` وضع المفتاح هناك.

## 🎨 تغيير اسم وشخصية البوت

افتح `api/chat.js` السطر ~55 ستجد:

```js
const defaultSystem = `أنت Derja AI، مساعد ذكي تتكلم بالدارجة...`
```

غيّرها كما تريد. مثلا لتجعله يتكلم فصحى أو فرنسية.

كذلك في `index.html` غيّر:
- `<title>Derja Ai</title>`
- `const GREETING = 'واه خويا!...'`
- `function creatorResponse() { return 'أنا Derja Ai...' }`

## 🖼️ تغيير اللوغو والفيديو

استبدل الملفات في `static/`:
- `logo.png` → اللوغو (40x40 يفضل PNG شفاف)
- `intro.mp4` → فيديو البداية (اختياري، يمكنك حذفه وحذف `<video>`)
- `send.png` → أيقونة الإرسال

## 🔄 كيف يعمل التحويل؟

الفرونت يرسل نفسه للـ Back:
```json
POST /api/chat
{ "messages": [{"role":"user","content":"سلام"}] }
```

`api/chat.js` يحوّلها لصيغة Gemini:
```json
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=...
```

ثم يرجع الرد بصيغة يفهمها الفرونت:
```json
{ "choices": [{"message":{"content":"واهلا خويا!"}}] }
```

## ❗ حل المشاكل الشائعة

| المشكلة | الحل |
|---------|------|
| `GOOGLE_API_KEY غير موجود` | نسيت تضيفه في Vercel → Settings → Environment Variables ثم Redeploy |
| `API key غير صحيح` | انسخ المفتاح كامل بدون مسافات |
| `429 تجاوزت الحد` | الخطة المجانية 60 طلب/دقيقة، انتظر دقيقة |
| صور لا تعمل | تأكد أن الصورة Base64 لم تتجاوز 4MB (حد Gemini) |

## 💡 تطوير إضافي
- يمكنك تغيير `GOOGLE_MODEL` إلى `gemini-2.0-flash` (أسرع) أو `gemini-1.5-pro` (أذكى)
- لإضافة Streaming عدّل `api/chat.js` ليستخدم `streamGenerateContent`
