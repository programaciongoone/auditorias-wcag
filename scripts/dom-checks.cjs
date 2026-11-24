'use strict';
// Supplemental heuristics: findings are review candidates, not WCAG verdicts.
async function inspect(page) {
  return page.evaluate(() => {
    const issues = [];
    const visible = el => !!el.getClientRects().length && getComputedStyle(el).visibility === 'visible' && !el.closest('[aria-hidden="true"],[inert]');
    const clean = s => (s || '').replace(/\s+/g,' ').trim();
    const name = el => clean((el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ')) || clean(el.getAttribute('aria-label')) || clean(el.textContent) || clean([...el.querySelectorAll('img[alt]')].map(i=>i.alt).join(' ')) || clean(el.getAttribute('title'));
    function selector(el) {
      const parts=[];
      for(let n=el;n && n.nodeType===1;n=n.parentElement) {
        if(n.id && document.querySelectorAll('#'+CSS.escape(n.id)).length===1){parts.unshift('#'+CSS.escape(n.id));break;}
        const siblings=n.parentElement ? [...n.parentElement.children].filter(x=>x.localName===n.localName):[n];
        parts.unshift(n.localName+':nth-of-type('+(siblings.indexOf(n)+1)+')');
      }
      return parts.join(' > ');
    }
    function add(el,code,message,type='warning'){
      issues.push({type,code,message,selector:selector(el),context:el.outerHTML.slice(0,1000)});
    }
    for(const a of document.querySelectorAll('a[href]')){
      if(!visible(a))continue;
      const imgs=[...a.querySelectorAll('img')].filter(visible);
      if(imgs.length && !name(a)) add(a,'linked-image-no-name','Imagen enlazada sin nombre accesible aparente; revisar ALT y nombre del enlace.','error');
      else if(!name(a)) add(a,'empty-link-review','Enlace sin nombre aparente; comprobar nombre accesible.','warning');
      for(const img of imgs) if(!clean(img.getAttribute('alt')) && !name(a)) add(img,'linked-image-alt-review','Imagen enlazada sin ALT significativo; comprobar contexto.');
      const next=a.nextElementSibling;
      if(next?.matches('a[href]') && visible(next) && next.href===a.href) add(next,'redundant-link','Enlace adyacente con idéntico destino; revisar redundancia.');
    }
    let previous=0;
    for(const h of document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')){
      if(!visible(h))continue;
      const level=Number(h.getAttribute('aria-level') || h.tagName.slice(1));
      if(!name(h))add(h,'empty-heading','Encabezado sin contenido aparente.');
      if(level>=1 && level<=6){if(level>previous+1)add(h,'heading-order','Salto de nivel '+previous+' a '+level+'; revisar jerarquía.');previous=level;}
    }
    for(const el of document.querySelectorAll('p,div,span,strong,b')){
      if(!visible(el)||el.closest('h1,h2,h3,h4,h5,h6,[role="heading"],a,button,nav')||el.children.length||!clean(el.textContent)||clean(el.textContent).length>100)continue;
      const s=getComputedStyle(el);
      if(parseFloat(s.fontSize)>=20 && (parseInt(s.fontWeight)>=600 || s.fontWeight==='bold'))add(el,'possible-heading','Texto destacado que podría ser un encabezado; revisión manual.');
    }
    for(const meta of document.querySelectorAll('meta[name="viewport" i]')){
      const c=meta.content||'';
      const m=c.match(/maximum-scale\s*=\s*([\d.]+)/i);
      if(/user-scalable\s*=\s*(no|0)(?:\s|,|;|$)/i.test(c)||(m&&Number(m[1])<5))add(meta,'viewport-zoom','Viewport con posible restricción de ampliación; verificar zoom.');
    }
    return {issues};
  });
}
module.exports={inspect};
