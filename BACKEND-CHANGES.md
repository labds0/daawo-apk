# تحديث سيرفر داوو (3 خطوات فقط — مفيش تعديل جوه أسطر موجودة)

افتح Worker «daawo-api» في Cloudflare ← Edit code، وبعدين:

1) **الصق كتلة الإضافات**: انسخ كل محتوى ملف worker-additions.js والصقه قبل السطر `export default {`

2) **سطر في route**: دوّر على السطر اللي فيه `await dailyBackup(env)` (بيبدأ بـ `if (m !== "GET")`)
   وحط تحته سطر جديد:
   `{ const r = await extraRoutes(env, me, m, p, body); if (r) return r; }`

3) **سطر في PATCH /users**: دوّر على السطر `if (body.perms !== undefined) u.perms = cleanPerms(body.perms);`
   وحط تحته سطر جديد:
   `applyUserExtras(u, body);`

اضغط Deploy. تنبيه: المهام والأدوار مش داخلة في النسخ الاحتياطي الحالي (الصناديق والمستخدمين بس).
