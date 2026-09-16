"use client";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="panel panel-pad" style={{ borderColor: "var(--security-stroke)", background: "var(--security-fill)" }}>
      <h1 className="page-title">Ошибка</h1>
      <p className="mt-2 text-sm">{error.message}</p>
      <button className="btn mt-4" type="button" onClick={reset}>
        Повторить
      </button>
    </div>
  );
}
