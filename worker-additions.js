/* ===================== إضافة: الصور + الأدوار + المهام =====================
   الصق الكتلة دي كلها قبل السطر:  export default {            */
PERM_KEYS.push("assignTasks");
PERM_LABEL.assignTasks = "إسناد المهام";
PERM_DEFAULTS.supervisor.assignTasks = true;

const _pubBase = pub;
pub = function (u) {
  return Object.assign(_pubBase(u), { avatar: u.avatar || null, roleId: u.roleId || null, roleName: u.roleName || null });
};

const AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
function cleanAvatar(v) {
  if (v === null || v === "") return "";
  if (typeof v !== "string" || v.length > 120000 || !AVATAR_RE.test(v))
    throw new HttpError(400, "الصورة لازم تكون JPG أو PNG أو WEBP وحجمها صغير");
  return v;
}
/* بتتنادى من PATCH /users/:username */
function applyUserExtras(u, body) {
  if (body.avatar !== undefined) { const a = cleanAvatar(body.avatar); if (a) u.avatar = a; else delete u.avatar; }
  if (body.role === "supervisor" || body.role === "employee") u.role = body.role;
  if (body.roleId !== undefined) {
    u.roleId = body.roleId ? String(body.roleId).slice(0, 40) : null;
    u.roleName = body.roleId && body.roleName ? String(body.roleName).slice(0, 60) : null;
  }
}

async function extraRoutes(env, me, m, p, body) {
  /* ---- حذف مستخدم (للمدير): المهام غير المنتهية بتتحذف، والمنتهية بتفضل ---- */
  const dm = p.match(/^\/users\/([^/]+)\/delete$/);
  if (m === "POST" && dm) {
    needRole(me, ["admin"]);
    const uname = decodeURIComponent(dm[1]);
    const users = await getJSON(env, "users", []);
    const idx = users.findIndex(x => x.username === uname);
    if (idx < 0) throw new HttpError(404, "المستخدم مش موجود");
    const u = users[idx];
    if (u.role === "admin" || u.username === me.username) throw new HttpError(400, "مينفعش تحذف حساب المدير");
    users.splice(idx, 1);
    await putJSON(env, "users", users);
    const tasks = await getJSON(env, "tasks", []);
    const keep = tasks.filter(t => t.assignee !== uname || t.status === "done");
    const removed = tasks.length - keep.length;
    if (removed) await putJSON(env, "tasks", keep);
    await audit(env, me, "user_delete", u.displayName, "حذف المستخدم @" + uname + (removed ? " مع " + removed + " مهمة غير منتهية" : ""));
    return json({ ok: true, removedTasks: removed });
  }

  /* ---- صورتي ---- */
  if (m === "PATCH" && p === "/me") {
    if (body.avatar === undefined) throw new HttpError(400, "مفيش تغيير");
    const a = cleanAvatar(body.avatar);
    const users = await getJSON(env, "users", []);
    const u = users.find(x => x.username === me.username);
    if (!u) throw new HttpError(404, "المستخدم مش موجود");
    if (a) u.avatar = a; else delete u.avatar;
    await putJSON(env, "users", users);
    await audit(env, me, "avatar", me.displayName, a ? "تغيير الصورة الشخصية" : "حذف الصورة الشخصية");
    return json({ ok: true });
  }

  /* ---- الأدوار (للمدير) ---- */
  if (p === "/roles" || p.startsWith("/roles/")) {
    needRole(me, ["admin"]);
    const roles = await getJSON(env, "roles", []);
    if (m === "GET" && p === "/roles") return json({ roles });
    if (m === "POST" && p === "/roles") {
      const label = String(body.label || "").trim().slice(0, 40);
      if (!label) throw new HttpError(400, "اكتب اسم الدور");
      if (roles.length >= 30) throw new HttpError(400, "وصلت للحد الأقصى من الأدوار");
      const r = { id: newId(), label, base: body.base === "supervisor" ? "supervisor" : "employee", perms: cleanPerms(body.perms) };
      roles.push(r);
      await putJSON(env, "roles", roles);
      await audit(env, me, "role_save", label, "إنشاء دور جديد");
      return json({ ok: true, role: r });
    }
    const rm = p.match(/^\/roles\/([\w-]+)(?:\/(delete))?$/);
    if (rm) {
      const idx = roles.findIndex(x => x.id === rm[1]);
      if (idx < 0) throw new HttpError(404, "الدور مش موجود");
      const r = roles[idx];
      const users = await getJSON(env, "users", []);
      if (m === "PATCH" && !rm[2]) {
        if (body.label !== undefined) { const l = String(body.label).trim().slice(0, 40); if (!l) throw new HttpError(400, "اكتب اسم الدور"); r.label = l; }
        if (body.base !== undefined) r.base = body.base === "supervisor" ? "supervisor" : "employee";
        if (body.perms !== undefined) r.perms = cleanPerms(body.perms);
        /* تعديل الدور بيتطبق على المستخدمين اللي عليه */
        users.forEach(u => { if (u.roleId === r.id) { u.role = r.base; u.roleName = r.label; u.perms = cleanPerms(r.perms); } });
        await putJSON(env, "roles", roles);
        await putJSON(env, "users", users);
        await audit(env, me, "role_save", r.label, "تعديل الدور وصلاحياته");
        return json({ ok: true });
      }
      if (m === "POST" && rm[2] === "delete") {
        roles.splice(idx, 1);
        users.forEach(u => { if (u.roleId === r.id) { u.roleId = null; u.roleName = null; } });
        await putJSON(env, "roles", roles);
        await putJSON(env, "users", users);
        await audit(env, me, "role_delete", r.label, "حذف الدور");
        return json({ ok: true });
      }
    }
  }

  /* ---- المهام ---- */
  if (p === "/tasks" || p.startsWith("/tasks/")) {
    const tasks = await getJSON(env, "tasks", []);
    const mgr = !!me.perms.assignTasks;
    if (m === "GET" && p === "/tasks")
      return json({ tasks: mgr ? tasks : tasks.filter(t => t.assignee === me.username) });
    if (m === "POST" && p === "/tasks") {
      needPerm(me, "assignTasks");
      const title = String(body.title || "").trim().slice(0, 120);
      if (!title) throw new HttpError(400, "اكتب المهمة");
      const users = await getJSON(env, "users", []);
      const who = users.find(x => x.username === String(body.assignee || ""));
      if (!who || who.active === false) throw new HttpError(400, "المستخدم ده مش موجود أو موقوف");
      const due = /^\d{4}-\d{2}-\d{2}$/.test(String(body.due || "")) ? body.due : null;
      const t = { id: newId(), title, note: String(body.note || "").trim().slice(0, 300), assignee: who.username,
                  due, status: "open", createdBy: me.username, createdAt: Date.now() };
      tasks.push(t);
      if (tasks.length > 1000) tasks.splice(0, tasks.length - 1000);
      await putJSON(env, "tasks", tasks);
      await audit(env, me, "task_add", title, "إسناد مهمة إلى " + who.displayName);
      return json({ ok: true, task: t });
    }
    const tm2 = p.match(/^\/tasks\/([\w-]+)(?:\/(delete))?$/);
    if (tm2) {
      const idx = tasks.findIndex(x => x.id === tm2[1]);
      if (idx < 0) throw new HttpError(404, "المهمة مش موجودة");
      const t = tasks[idx];
      if (m === "PATCH" && !tm2[2]) {
        if (!mgr && t.assignee !== me.username) throw new HttpError(403, "مش مسموح لك بالعملية دي");
        if (body.status !== "open" && body.status !== "done") throw new HttpError(400, "حالة غير صالحة");
        t.status = body.status;
        if (t.status === "done") { t.doneAt = Date.now(); t.doneBy = me.username; } else { delete t.doneAt; delete t.doneBy; }
        await putJSON(env, "tasks", tasks);
        await audit(env, me, "task_status", t.title, t.status === "done" ? "تم إنهاء المهمة" : "إعادة فتح المهمة");
        return json({ ok: true });
      }
      if (m === "POST" && tm2[2] === "delete") {
        needPerm(me, "assignTasks");
        tasks.splice(idx, 1);
        await putJSON(env, "tasks", tasks);
        await audit(env, me, "task_delete", t.title, "حذف المهمة");
        return json({ ok: true });
      }
    }
  }
  return null;
}
/* =================== نهاية الإضافة =================== */
