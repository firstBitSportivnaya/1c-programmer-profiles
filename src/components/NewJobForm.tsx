import { saveJobAction } from "@/app/actions";
import { isAdmin } from "@/lib/auth";

export async function NewJobForm() {
  if (!(await isAdmin())) return null;
  return (
    <form action={saveJobAction} className="panel panel-pad mt-4 grid gap-3 text-sm md:grid-cols-2">
      <h2 className="section-title md:col-span-2 mb-0">Новая должность</h2>
      <input name="id" placeholder="id" className="field" required />
      <input name="name" placeholder="Название" className="field" required />
      <input name="rankOrder" type="number" placeholder="Порядок" className="field" required />
      <select name="lane" className="field">
        <option value="executor">Исполнитель</option>
        <option value="manager">Руководитель</option>
        <option value="other">Другое</option>
      </select>
      <button className="btn-primary md:col-span-2 w-fit" type="submit">
        Создать
      </button>
    </form>
  );
}
