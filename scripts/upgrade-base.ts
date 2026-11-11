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
import path from "node:path";
import {
  competencyLinks,
  employeeAchievements,
  employeeCompetencyConfirmations,
  employeeCompetencyMarks,
  employees,
  idpAssignmentOptions,
  idpAssignmentQuestions,
  idpAssignments,
  idpItemAttempts,
  idpItemOptions,
  idpItemQuestions,
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

/** Отказ до записи: без DB_PATH или с путём в data/ скрипт попал бы в рабочую базу. */
function assertSafeDbPath() {
  const given = process.env.DB_PATH?.trim();
  if (!given) {
    console.error("DB_PATH не задан. upgrade-base.ts не пишет в data/profiles.sqlite.");
    process.exit(1);
  }
  const abs = path.resolve(given);
  const dataDir = path.resolve("data");
  const fromData = path.relative(dataDir, abs);
  if (fromData === "" || (!fromData.startsWith("..") && !path.isAbsolute(fromData))) {
    console.error("DB_PATH указывает в data/. Рабочую базу скрипт не меняет.");
    process.exit(1);
  }
}

function main() {
  assertSafeDbPath();
  migrate();
  const db = getDb();
  const t = now();
  const password = hashPassword("upgrade-base-password");
  const skills = targetSkills("programmer", 3);

  getSqlite()
    .transaction(() => {
      db.insert(employees)
        .values([
          { id: "emp-admin", login: "admin", name: "Админ", passwordHash: password, jobId: "team-lead", managerId: null, isAdmin: 1, isActive: 1, sessionVersion: 0, updatedAt: t },
          { id: "emp-manager", login: "manager", name: "Руководитель", passwordHash: password, jobId: "lead", managerId: null, isAdmin: 0, isActive: 1, sessionVersion: 0, updatedAt: t },
          { id: "emp-junior", login: "junior", name: "Младший", passwordHash: password, jobId: "junior", managerId: "emp-manager", isAdmin: 0, isActive: 1, sessionVersion: 0, updatedAt: t },
          { id: "emp-left", login: "left", name: "Уволен", passwordHash: password, jobId: "junior", managerId: "emp-manager", isAdmin: 0, isActive: 0, sessionVersion: 0, updatedAt: t },
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
            level: i === 0 ? 1 : null,
            archived: 0,
            updatedAt: t,
          })),
        )
        .run();

      db.insert(idpAssignmentQuestions)
        .values({ id: "q-asg-1", assignmentId: "asg-1", prompt: "Что сделать сначала?", sortOrder: 0 })
        .run();
      db.insert(idpAssignmentOptions)
        .values([
          { id: "opt-asg-1-a", questionId: "q-asg-1", text: "Прочитать", isCorrect: 1, sortOrder: 0 },
          { id: "opt-asg-1-b", questionId: "q-asg-1", text: "Пропустить", isCorrect: 0, sortOrder: 1 },
        ])
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

      const items = db
        .insert(idpItems)
        .values([
          {
            idpId: "idp-active",
            assignmentId: "asg-1",
            competencyId: skills[0].competencyId,
            competencyName: skills[0].competencyName,
            requiredLevel: skills[0].level,
            assignmentName: "Задание 1",
            assignmentLevel: 1,
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
            assignmentLevel: null,
            learnText: "Что изучить",
            verifyText: "Как проверить",
            dueOn: null,
            status: "in_progress",
            acceptedById: null,
            acceptedAt: null,
            sortOrder: 1,
          },
        ])
        .returning({ id: idpItems.id, assignmentId: idpItems.assignmentId })
        .all();
      const withTest = items.find((item) => item.assignmentId === "asg-1");
      if (withTest) {
        db.insert(idpItemQuestions)
          .values({ id: "iq-asg-1", itemId: withTest.id, prompt: "Что сделать сначала?", sortOrder: 0 })
          .run();
        db.insert(idpItemOptions)
          .values([
            { id: "iopt-asg-1-a", questionId: "iq-asg-1", text: "Прочитать", isCorrect: 1, sortOrder: 0 },
            { id: "iopt-asg-1-b", questionId: "iq-asg-1", text: "Пропустить", isCorrect: 0, sortOrder: 1 },
          ])
          .run();
        db.insert(idpItemAttempts)
          .values({ id: "att-asg-1", itemId: withTest.id, passed: 1, createdAt: t })
          .run();
      }

      db.insert(employeeCompetencyMarks)
        .values([
          { employeeId: "emp-junior", competencyId: skills[0].competencyId, status: "has", note: "Уже разбирал", updatedAt: t },
          { employeeId: "emp-junior", competencyId: skills[1].competencyId, status: "in_progress", note: "", updatedAt: t },
        ])
        .run();

      db.insert(competencyLinks)
        .values([
          { competencyId: skills[0].competencyId, kind: "its", title: "Стандарты разработки", url: "https://its.1c.ru/db/v8std", sortOrder: 0, updatedAt: t },
          { competencyId: skills[0].competencyId, kind: "video", title: "Разбор", url: "https://example.org/video", sortOrder: 1, updatedAt: t },
        ])
        .run();

      // Каталог заполняет migrate(); здесь — выдачи, чтобы следующая проверка обновления видела их до и после.
      db.insert(employeeAchievements)
        .values([
          { employeeId: "emp-junior", achievementId: "idp-first-step", source: "auto", ruleKey: "idp.first-accepted-item", sourceRef: "idp-active", grantedAt: t },
          { employeeId: "emp-junior", achievementId: "idp-completed", source: "auto", ruleKey: "idp.completed", sourceRef: "idp-done", grantedAt: t },
        ])
        .run();

      // Ручные подтверждения (ADR 0011): одна действующая, одна отозванная, чтобы проверка видела обе.
      db.insert(employeeCompetencyConfirmations)
        .values([
          { employeeId: "emp-junior", competencyId: skills[0].competencyId, competencyName: skills[0].competencyName, note: "Проект на проде", confirmedAt: t, confirmedById: "emp-manager" },
          { employeeId: "emp-junior", competencyId: skills[1].competencyId, competencyName: skills[1].competencyName, note: "Наставничество", confirmedAt: t, confirmedById: "emp-manager", revokedAt: t, revokedById: "emp-admin", revokeReason: "Подтвердили по ошибке" },
        ])
        .run();
      return true;
    })
    .deferred(null);

  console.log(
    "upgrade base: employees=4 idps=2 idp_assignments=3 idp_pool=3 idp_items=2 employee_competency_marks=2 competency_links=2 idp_assignment_questions=1 idp_item_questions=1 idp_item_attempts=1 achievements=30 employee_achievements=2 employee_competency_confirmations=2",
  );
}

main();
