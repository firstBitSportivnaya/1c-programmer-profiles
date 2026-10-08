/**
 * Заполняет базу после `npm run db:seed` строками в таблицах, которые seed не трогает:
 * сотрудники, ИПР, задания, пул и пункты плана. Нужна проверке обновления в CI:
 * базу собирает код `main`, затем `check:upgrade` открывает её кодом ветки.
 *
 * Скрипт пишет в схему той ветки, из которой запущен. Меняешь таблицы — правь и его,
 * тогда следующий pull request получит базу уже с новыми колонками.
 */
import { getDb, getSqlite, now } from "../src/db";
import { migrate } from "../src/db/migrate";
import {
  competencyLinks,
  employeeCompetencyMarks,
  employees,
  idpAssignments,
  idpItems,
  idpPool,
  idps,
} from "../src/db/schema";
import { hashPassword } from "../src/lib/password";

type TargetSkill = { competencyId: string; competencyName: string; level: number | null };

/** Первые строки профиля целевой должности: из них собираются пул и задания. */
function targetSkills(jobId: string, limit: number): TargetSkill[] {
  const rows = getSqlite()
    .prepare(
      `SELECT ps.competency_id AS competencyId, c.name AS competencyName, ps.level AS level
       FROM profile_skills ps
       JOIN profiles p ON p.id = ps.profile_id
       JOIN competencies c ON c.id = ps.competency_id
       WHERE p.job_id = ? AND c.type <> 'duty'
       ORDER BY ps.sort_order
       LIMIT ?`,
    )
    .all(jobId, limit) as TargetSkill[];
  if (rows.length < limit) throw new Error(`в профиле ${jobId} меньше ${limit} навыков, seed не загружен?`);
  return rows;
}

function main() {
  migrate();
  const db = getDb();
  const t = now();
  const password = hashPassword("upgrade-base-password");
  const skills = targetSkills("programmer", 3);

  getSqlite()
    .transaction(() => {
      db.insert(employees)
        .values([
          { id: "emp-admin", login: "admin", name: "Админ", passwordHash: password, jobId: "team-lead", managerId: null, isAdmin: 1, isActive: 1, updatedAt: t },
          { id: "emp-manager", login: "manager", name: "Руководитель", passwordHash: password, jobId: "lead", managerId: null, isAdmin: 0, isActive: 1, updatedAt: t },
          { id: "emp-junior", login: "junior", name: "Младший", passwordHash: password, jobId: "junior", managerId: "emp-manager", isAdmin: 0, isActive: 1, updatedAt: t },
          { id: "emp-left", login: "left", name: "Уволен", passwordHash: password, jobId: "junior", managerId: "emp-manager", isAdmin: 0, isActive: 0, updatedAt: t },
        ])
        .run();

      db.insert(idpAssignments)
        .values(
          skills.slice(0, 2).map((s, i) => ({
            id: `asg-${i + 1}`,
            competencyId: s.competencyId,
            name: `Задание ${i + 1}`,
            learnText: "Что изучить",
            verifyText: "Как проверить",
            archived: 0,
            updatedAt: t,
          })),
        )
        .run();

      db.insert(idps)
        .values([
          { id: "idp-active", employeeId: "emp-junior", sourceJobId: "junior", targetJobId: "programmer", createdById: "emp-manager", periodStart: "2026-01-01", periodEnd: "2026-06-30", status: "active", updatedAt: t },
          { id: "idp-done", employeeId: "emp-junior", sourceJobId: "intern", targetJobId: "junior", createdById: "emp-manager", periodStart: "2025-01-01", periodEnd: "2025-06-30", status: "completed", updatedAt: t },
        ])
        .run();

      db.insert(idpPool)
        .values(skills.map((s) => ({ idpId: "idp-active", competencyId: s.competencyId, competencyName: s.competencyName, requiredLevel: s.level })))
        .run();

      db.insert(idpItems)
        .values([
          {
            idpId: "idp-active",
            assignmentId: "asg-1",
            competencyId: skills[0].competencyId,
            competencyName: skills[0].competencyName,
            requiredLevel: skills[0].level,
            assignmentName: "Задание 1",
            learnText: "Что изучить",
            verifyText: "Как проверить",
            dueOn: "2026-03-31",
            status: "done",
            acceptedById: "emp-manager",
            acceptedAt: t,
            sortOrder: 0,
          },
          {
            idpId: "idp-active",
            assignmentId: null,
            competencyId: skills[1].competencyId,
            competencyName: skills[1].competencyName,
            requiredLevel: skills[1].level,
            assignmentName: "Своё задание",
            learnText: "Что изучить",
            verifyText: "Как проверить",
            dueOn: null,
            status: "in_progress",
            acceptedById: null,
            acceptedAt: null,
            sortOrder: 1,
          },
        ])
        .run();

      db.insert(employeeCompetencyMarks)
        .values([
          { employeeId: "emp-junior", competencyId: skills[0].competencyId, status: "has", updatedAt: t },
          { employeeId: "emp-junior", competencyId: skills[1].competencyId, status: "in_progress", updatedAt: t },
        ])
        .run();

      db.insert(competencyLinks)
        .values([
          { competencyId: skills[0].competencyId, kind: "its", title: "Стандарты разработки", url: "https://its.1c.ru/db/v8std", sortOrder: 0, updatedAt: t },
          { competencyId: skills[0].competencyId, kind: "video", title: "Разбор", url: "https://example.org/video", sortOrder: 1, updatedAt: t },
        ])
        .run();
      return true;
    })
    .deferred(null);

  console.log(
    "upgrade base: employees=4 idps=2 idp_assignments=2 idp_pool=3 idp_items=2 employee_competency_marks=2 competency_links=2",
  );
}

main();
