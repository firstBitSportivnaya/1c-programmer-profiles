import { redirect } from "next/navigation";
import { Achievements } from "@/components/Achievements";
import { getSessionEmployee } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Достижения сотрудника — единственное место, где виден весь список. Страница только своя:
 * адреса с id сотрудника нет, чужие ачивки по ссылке не открыть.
 */
export default async function MyAchievementsPage() {
  const employee = await getSessionEmployee();
  if (!employee) redirect("/login");
  return (
    <article className="space-y-6">
      <div className="page-kicker">
        <a href="/me" className="link-accent">
          Кабинет
        </a>
        <h1 className="page-title">Достижения</h1>
      </div>
      <p className="muted">
        Достижение — следствие текущих приёмок, очков нет: сняли приёмку — ачивка пропала.
      </p>
      <Achievements employeeId={employee.id} />
    </article>
  );
}
