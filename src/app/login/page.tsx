export const dynamic = "force-dynamic";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-[80vh] items-center justify-center">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8">
        <div className="mb-6 text-center">
          <div className="text-4xl">🥜</div>
          <h1 className="mt-2 text-xl font-bold">Nut Analytics</h1>
          <p className="mt-1 text-sm text-white/50">Sign in to your dashboard</p>
        </div>

        {error && (
          <p className="mb-4 rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-sm text-red-300">
            Wrong email or password.
          </p>
        )}

        <form action="/api/auth/login" method="post" className="flex flex-col gap-3">
          <input
            type="email"
            name="email"
            placeholder="Email"
            autoComplete="username"
            required
            className="rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-400/60"
          />
          <input
            type="password"
            name="password"
            placeholder="Password"
            autoComplete="current-password"
            required
            className="rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-emerald-400/60"
          />
          <button
            type="submit"
            className="mt-1 rounded-lg bg-emerald-500 px-3 py-2.5 text-sm font-semibold text-black transition hover:bg-emerald-400"
          >
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
