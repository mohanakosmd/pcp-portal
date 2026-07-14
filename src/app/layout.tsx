import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@/styles/globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["100", "200", "300", "400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "PCP Portal",
  description: "Primary Care Physician portal",
};

// Runs before hydration. Next names each JS chunk by a per-build content hash,
// so any HTML a browser cached before a deploy points at chunk files the new
// build no longer has → they 404 and throw ChunkLoadError. This catches that and
// does ONE cache-busting reload to pull the fresh HTML/chunks. A short
// sessionStorage guard prevents a reload loop if something else is wrong.
const CHUNK_RELOAD_GUARD = `(function(){
  try {
    var KEY='__chunk_reload_ts__';
    function isChunkErr(m){return /Loading chunk [\\w-]+ failed|ChunkLoadError|Loading CSS chunk|error loading dynamically imported module|Failed to fetch dynamically imported module/i.test(m||'');}
    function recover(m){
      if(!isChunkErr(m))return;
      try{
        var last=parseInt(sessionStorage.getItem(KEY)||'0',10);
        if(Date.now()-last<15000)return;
        sessionStorage.setItem(KEY,String(Date.now()));
      }catch(e){}
      var u=new URL(window.location.href);
      u.searchParams.set('_r',String(Date.now()));
      window.location.replace(u.toString());
    }
    window.addEventListener('error',function(e){recover((e&&(e.message||(e.error&&e.error.message)))||'');},true);
    window.addEventListener('unhandledrejection',function(e){var r=e&&e.reason;recover((r&&(r.message||r.name))||'');});
  }catch(e){}
})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: CHUNK_RELOAD_GUARD }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
