import fs from 'node:fs';let html=fs.readFileSync('index.html','utf8');
const marker='<span class="ecu-num">17</span><div class="ecu-info"><strong dir="ltr">Power Distribution</strong>';const m=html.indexOf(marker),moduleStart=html.lastIndexOf('<li class="ecu-item',m);let liDepth=0,moduleEnd=-1;for(const x of html.slice(moduleStart).matchAll(/<li\b[^>]*>|<\/li>/g)){liDepth+=x[0].startsWith('</')?-1:1;if(!liDepth){moduleEnd=moduleStart+x.index+x[0].length;break;}}if(moduleEnd<0)throw Error('Power Distribution module boundary missing');let module=html.slice(moduleStart,moduleEnd);
function endOf(source,start,tag){let d=0;const re=new RegExp(`<${tag}\\b[^>]*>|<\\/${tag}>`,'g');for(const x of source.slice(start).matchAll(re)){d+=x[0].startsWith('</')?-1:1;if(!d)return start+x.index+x[0].length;}throw Error(`Unbalanced ${tag}`);}
function summary(chunk){return chunk.slice(0,chunk.indexOf('</summary>')+10);}
const frontStart=module.indexOf('<details class="bcm-group pcm-components pdc-assembly-collection">');const rearStart=module.indexOf('<details class="bcm-group pcm-components pdc-assembly-collection">',frontStart+5);if(frontStart<0||rearStart<0)throw Error('PDC groups missing');const frontEnd=endOf(module,frontStart,'details');let front=module.slice(frontStart,frontEnd);if(!summary(front).includes('Front Power Distribution Center Assembly'))throw Error('Expected Front PDC first');
const relayItems=[],otherItems=[],pageStarts=[...front.matchAll(/<details class="bcm-group pcm-components">/g)].map(x=>x.index);
for(const pageStart of pageStarts.reverse()){
 const pageEnd=endOf(front,pageStart,'details'),page=front.slice(pageStart,pageEnd);if(!summary(page).includes('Fig.'))continue;let cleanPage=page;const rows=[...page.matchAll(/<li class="pcm-component-row">/g)].map(x=>x.index);
 for(const rowStart of rows.reverse()){
  const rowEnd=endOf(cleanPage,rowStart,'li'),row=cleanPage.slice(rowStart,rowEnd);const name=row.match(/<summary><strong dir="ltr">([^<]+)<\/strong>/)?.[1];if(!name||/^Fuse\s+/i.test(name))continue;
  let clean=row.replace(/<p class="pcm-component-description"><strong>المخطط:<\/strong>[\s\S]*?<\/p>/g,'').replace(/\s*\(?Fig\.\s*\d+(?:\s*\(صفحة\s*\d+\))?\)?/g,'');
  const item={name,row:clean,normalized:clean.replace(/\s+/g,'')};
  (name.includes('Relay')?'relay': 'other')==='relay'?relayItems.push(item):otherItems.push(item);
  cleanPage=cleanPage.slice(0,rowStart)+cleanPage.slice(rowEnd);
 }
 front=front.slice(0,pageStart)+front.slice(pageEnd);
}
function unique(items){const out=[],seen=new Set();for(const x of items){const key=x.name+'|'+x.normalized;if(seen.has(key))continue;seen.add(key);out.push(x);}return out;}
const relays=unique(relayItems),others=unique(otherItems);const coll=(a,b)=>a.name.localeCompare(b.name,'en',{numeric:true,sensitivity:'base'});relays.sort(coll);others.sort(coll);
if(!relays.length)throw Error('No Front PDC relays were found.');
function collection(title,subtitle,items,cls){return `<details class="bcm-group pcm-components ${cls}"><summary><span class="bcm-ico">${cls.includes('relay')?'🔁':'🔌'}</span><span class="bcm-title"><strong>${title}</strong><small>${subtitle}</small></span><span class="ecu-abbr">${items.length}</span></summary><div class="pcm-component-groups"><section class="pcm-component-group"><ol class="pcm-component-list" start="1">${items.map(x=>x.row).join('')}</ol></section></div></details>`;}
const relayGroup=collection('الريلايات','كل ريلايات المركز الأمامي مرتبة بالاسم والتسلسل',relays,'pdc-relay-collection');const otherGroup=others.length?collection('بقية التفاصيل','العناصر الأخرى المرتبطة بمركز التوزيع الأمامي',others,'pdc-other-collection'):'';
const fuseEnd=endOf(front,front.indexOf('<details class="bcm-group pcm-components pdc-fuse-collection">'),'details');front=front.slice(0,fuseEnd)+relayGroup+otherGroup+front.slice(fuseEnd);
module=module.slice(0,frontStart)+front+module.slice(frontEnd);html=html.slice(0,moduleStart)+module+html.slice(moduleEnd);fs.writeFileSync('index.html',html,'utf8');console.log(`Grouped ${relays.length} relays; ${others.length} other items; exact relay duplicates removed: ${relayItems.length-relays.length}.`);console.log(relays.map(x=>x.name).join(' · '));
