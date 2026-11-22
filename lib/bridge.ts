// Builds the sandboxed iframe document for a generated diagram.
// The diagram's own HTML runs first; our bridge script is appended last and is
// the only channel back to the host page (window.parent.postMessage).

import { DIAGRAM_TOKENS } from "./prompts";
import type { Diagram } from "./types";

const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'";

const TOKENS_CSS = Object.entries(DIAGRAM_TOKENS)
  .map(([k, v]) => `${k}:${v};`)
  .join("");

const BASE_CSS = `
:root{${TOKENS_CSS}color-scheme:light;}
*,*::before,*::after{box-sizing:border-box;}
html,body{margin:0;padding:0;background:#fff;}
html{overflow-x:hidden;}
body{display:flow-root;overflow-x:hidden;color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;}
svg{max-width:100%;}
[data-explore]{cursor:pointer;}
/* Resting affordance so clickable parts read as orange/clickable before hover. */
:not(svg *)[data-explore]{text-decoration:underline dashed rgba(229,112,47,.8);text-decoration-thickness:1.5px;text-underline-offset:3px;outline:1.5px dashed rgba(229,112,47,.45);outline-offset:2px;border-radius:4px;}
svg [data-explore]{filter:drop-shadow(0 0 1.5px rgba(229,112,47,.95));animation:curio-pulse 2.6s ease-in-out infinite;}
svg [data-explore]:hover{filter:drop-shadow(0 0 3px rgba(229,112,47,1));animation:none;}
@keyframes curio-pulse{50%{filter:drop-shadow(0 0 3.5px rgba(229,112,47,.55));}}
@media (prefers-reduced-motion:reduce){svg [data-explore]{animation:none;}}
:not(svg *)[data-explore][data-active]{outline:2px solid var(--accent);}
svg [data-explore][data-active]{filter:drop-shadow(0 0 4px rgba(229,112,47,1));animation:none;}
[data-explore]:focus{outline:none;}
[data-explore]:focus-visible{outline:2px solid var(--accent);outline-offset:3px;}
[data-active]{outline:2px solid var(--accent);outline-offset:3px;border-radius:4px;}
svg [data-active]{filter:drop-shadow(0 0 3px rgba(229,112,47,.6));}
`;

// Plain ES5 so it runs anywhere; kept tiny and dependency-free.
const BRIDGE_JS = `
(function(){
  function post(m){ m.ns="curio"; try{ window.parent.postMessage(m,"*"); }catch(e){} }
  var active=null;
  function find(t){ return t && t.closest ? t.closest("[data-explore]") : null; }
  function fire(el){
    var id=el.getAttribute("data-explore"); if(!id) return;
    if(active && active!==el) active.removeAttribute("data-active");
    active=el; el.setAttribute("data-active","");
    post({type:"explore",id:id});
  }
  document.addEventListener("click",function(e){ var el=find(e.target); if(el) fire(el); });
  document.addEventListener("keydown",function(e){
    if(e.key!=="Enter" && e.key!==" " && e.key!=="Spacebar") return;
    var el=find(e.target); if(!el) return;
    e.preventDefault(); fire(el);
  });
  var last=-1;
  function measure(){
    var b=document.body, d=document.documentElement;
    var h=Math.ceil(Math.max(b ? b.scrollHeight : 0, b ? b.getBoundingClientRect().height : 0));
    if(!h) h=d.scrollHeight;
    if(h!==last){ last=h; post({type:"height",height:h}); }
  }
  if(typeof ResizeObserver!=="undefined"){
    var ro=new ResizeObserver(measure);
    ro.observe(document.documentElement);
    if(document.body) ro.observe(document.body);
  }
  function ready(){ post({type:"ready"}); measure(); setTimeout(measure,300); setTimeout(measure,1500); }
  if(document.readyState==="complete") ready(); else window.addEventListener("load",ready);
})();
`;

export function buildSrcDoc(diagram: Diagram): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${BASE_CSS}</style>
</head>
<body>
${diagram.html}
<script>${BRIDGE_JS}</script>
</body>
</html>`;
}
