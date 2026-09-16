import { ThemeToggle } from "@/components/ThemeToggle";
import type { SessionEmployee } from "@/lib/auth";

export function Header({ employee }: { employee: SessionEmployee | null }) {
  return (
    <header className="toolbar">
      <div className="toolbar-inner">
        <a href="/" className="brand">
          <span className="pulse-dot" />
          Профили должностей
        </a>
        <nav className="flex items-center gap-1">
          <a href="/" className="nav-link">
            Граф
          </a>
          <a href="/compare" className="nav-link">
            Сравнение
          </a>
          {employee ? (
            <a href="/me" className="nav-link">
              Кабинет
            </a>
          ) : null}
          {employee ? (
            <a href="/idps" className="nav-link">
              ИПР
            </a>
          ) : null}
          {employee?.isAdmin || employee ? (
            <a href="/people" className="nav-link">
              Сотрудники
            </a>
          ) : null}
          {employee?.isAdmin ? (
            <a href="/admin/competencies" className="nav-link">
              Компетенции
            </a>
          ) : null}
          {employee ? (
            <form action="/api/session" method="post">
              <input type="hidden" name="intent" value="logout" />
              <button type="submit" className="nav-link">
                Выйти
              </button>
            </form>
          ) : (
            <a href="/login" className="nav-link">
              Войти
            </a>
          )}
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
