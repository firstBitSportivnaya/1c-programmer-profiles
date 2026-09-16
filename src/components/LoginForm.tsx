export function LoginForm() {
  return (
    <form action="/api/session" method="post" className="space-y-3">
      <input type="hidden" name="intent" value="login" />
      <label className="lbl">
        Логин
        <input className="field" name="login" autoComplete="username" required minLength={2} maxLength={40} />
      </label>
      <label className="lbl">
        Пароль
        <input className="field" type="password" name="password" autoComplete="current-password" required />
      </label>
      <button className="btn-primary w-full" type="submit">
        Войти
      </button>
    </form>
  );
}

export function BootstrapAdminForm({ jobs }: { jobs: { id: string; name: string }[] }) {
  return (
    <form id="bootstrap-admin" action="/api/session" method="post" className="space-y-3">
      <input type="hidden" name="intent" value="bootstrap" />
      <label className="lbl">
        Пароль из .env.local
        <input className="field" type="password" name="envPassword" autoComplete="off" required />
      </label>
      <label className="lbl">
        Логин
        <input className="field" name="login" autoComplete="off" required minLength={2} maxLength={40} />
      </label>
      <label className="lbl">
        Имя
        <input className="field" name="name" autoComplete="off" required />
      </label>
      <label className="lbl">
        Должность
        <select className="field" name="jobId" required>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.name}
            </option>
          ))}
        </select>
      </label>
      <label className="lbl">
        Пароль учётки
        <input
          className="field"
          type="password"
          name="accountPassword"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </label>
      <p className="muted text-xs">Пароль учётки — не короче 8 символов. Это не пароль из .env.local.</p>
      <button className="btn-primary w-full" type="submit">
        Создать первого админа
      </button>
    </form>
  );
}
