import Link from "next/link";
import { logoutAction } from "@/app/actions";
import { ThemeToggle } from "@/components/ThemeToggle";

export function Header({ admin }: { admin: boolean }) {
  return (
    <header className="toolbar">
      <div className="toolbar-inner">
        <Link href="/" className="brand">
          <span className="pulse-dot" />
          Профили должностей
        </Link>
        <nav className="flex items-center gap-1">
          <Link href="/" className="nav-link">
            Граф
          </Link>
          <Link href="/compare" className="nav-link">
            Сравнение
          </Link>
          {admin ? (
            <Link href="/admin/competencies" className="nav-link">
              Компетенции
            </Link>
          ) : null}
          {admin ? (
            <form action={logoutAction}>
              <button type="submit" className="nav-link">
                Выйти
              </button>
            </form>
          ) : (
            <Link href="/admin/login" className="nav-link">
              Войти
            </Link>
          )}
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
