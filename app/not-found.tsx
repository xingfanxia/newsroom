import Link from "next/link";

export default function NotFound() {
  return (
    <html lang="zh">
      <body className="bg-[#0a0d14] text-[#f0f5fa]">
        <main className="grid min-h-dvh place-items-center px-6">
          <div className="text-center">
            <div className="font-mono text-[68px] font-[510] text-[#3ee6e6]">
              404
            </div>
            <p className="mt-2 text-[#a8b4c2]">
              Page not found / 未找到页面
            </p>
            <Link
              href="/zh"
              className="mt-6 inline-flex rounded-md border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-[#f0f5fa] hover:bg-white/[0.05]"
            >
              Go home / 返回首页
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
