// Vercel serverless endpoint: extract basic product details from a public product page.
// This is a best-effort parser, not a guarantee. Some shops block bots or hide multipack counts.
const dns = require("node:dns").promises;
const net = require("node:net");

function isPrivateIPv4(ip) {
  const p = ip.split(".").map(Number);
  return p.length !== 4 || p[0] === 10 || p[0] === 127 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) || p[0] === 0;
}
function isPrivateIPv6(ip) {
  const x = ip.toLowerCase();
  return x === "::1" || x === "::" || x.startsWith("fc") || x.startsWith("fd") ||
    x.startsWith("fe80:") || x.startsWith("::ffff:127.") || x.startsWith("::ffff:10.");
}
async function validatePublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error("Enter a valid product page URL."); }
  if (!["https:", "http:"].includes(u.protocol)) throw new Error("Only HTTP or HTTPS product URLs are supported.");
  if (u.username || u.password) throw new Error("URLs containing login credentials are not supported.");
  const host = u.hostname.toLowerCase();
  if (["localhost", "localhost.localdomain"].includes(host) || host.endsWith(".local") || host.endsWith(".internal"))
    throw new Error("That host is not a public website.");
  if (net.isIP(host)) {
    if ((net.isIPv4(host) && isPrivateIPv4(host)) || (net.isIPv6(host) && isPrivateIPv6(host)))
      throw new Error("Private network addresses are not allowed.");
  } else {
    const addresses = await dns.lookup(host, {all:true}).catch(() => []);
    if (!addresses.length) throw new Error("Could not resolve that website. Check the URL.");
    for (const a of addresses) {
      if ((net.isIPv4(a.address) && isPrivateIPv4(a.address)) || (net.isIPv6(a.address) && isPrivateIPv6(a.address)))
        throw new Error("That website resolves to a private network address.");
    }
  }
  return u;
}
function decode(s) {
  return String(s || "").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'")
   .replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n))
   .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16))).trim();
}
function flattenJsonLd(obj, out=[]) {
  if (!obj) return out;
  if (Array.isArray(obj)) { obj.forEach(x=>flattenJsonLd(x,out)); return out; }
  if (typeof obj==="object") {
    out.push(obj);
    if (obj["@graph"]) flattenJsonLd(obj["@graph"],out);
    if (obj.mainEntity) flattenJsonLd(obj.mainEntity,out);
    if (obj.itemListElement) flattenJsonLd(obj.itemListElement,out);
  }
  return out;
}
function first(...vals) { return vals.find(v=>v!==undefined && v!==null && String(v).trim()!==""); }
function parsePage(html, url) {
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  let objects=[];
  for (const m of scripts) {
    try { objects.push(...flattenJsonLd(JSON.parse(m[1].trim()))); } catch {}
  }
  const products=objects.filter(o=>{
    const t=o["@type"]; return t==="Product" || (Array.isArray(t)&&t.includes("Product")) || o.name && (o.offers || o.price);
  });
  const product=products[0]||{};
  const offers=Array.isArray(product.offers)?product.offers[0]:(product.offers||{});
  const meta=(prop)=> {
    const esc=prop.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    let m=html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]+content=["']([^"']+)["']`, "i"));
    if(!m)m=html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${esc}["']`, "i"));
    return m?decode(m[1]):"";
  };
  const title=first(product.name,meta("og:title"),meta("twitter:title"),(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]);
  let rawPrice=first(offers.price,offers.lowPrice,offers.priceSpecification&&offers.priceSpecification.price,product.price,meta("product:price:amount"),meta("og:price:amount"));
  if(rawPrice && typeof rawPrice==="object") rawPrice=rawPrice.value;
  if(!rawPrice) {
    const visible=html.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ");
    const patterns=[/(?:price|current price)[^$]{0,70}\$\s?(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/i,/\$\s?(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/];
    for(const re of patterns){const m=visible.match(re);if(m){rawPrice=m[1].replace(/,/g,"");break;}}
  }
  const price=rawPrice!=null && Number.isFinite(Number(String(rawPrice).replace(/[$,]/g,"")))?Number(String(rawPrice).replace(/[$,]/g,"")):null;
  const bodyText=decode(html.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," "));
  let quantity=first(product.numberOfItems,product.size,product.additionalProperty&&Array.isArray(product.additionalProperty)&&product.additionalProperty.find(p=>/count|quantity|pack|units/i.test(p.name||""))?.value);
  if(quantity && typeof quantity==="object") quantity=quantity.value;
  if(!quantity) {
    const source=[title||"",meta("og:description"),meta("description"),bodyText.slice(0,10000)].join(" ");
    const patterns=[/\b(?:pack of|package of|case of|box of)\s*(\d{1,3})\b/i,/\b(\d{1,3})\s*(?:count|ct|pieces|pcs|packs|pack|per pack)\b/i,/\b(\d{1,3})\s*[- ]?(?:count|ct)\b/i];
    for(const re of patterns){const m=source.match(re);if(m){quantity=m[1];break;}}
  }
  if(quantity && typeof quantity==="string") { const m=quantity.match(/\d+/); quantity=m?Number(m[0]):null; }
  if(!Number.isFinite(Number(quantity)) || Number(quantity)<1) quantity=null; else quantity=Number(quantity);
  return {
    name: title ? decode(title).replace(/\s*[|–-]\s*(Amazon|Walmart|Target|Costco).*$/i,"").slice(0,120) : "",
    packCost: price,
    quantity,
    suggestedSellPrice: null,
    notes: [
      title ? "Product name found." : "Product name was not detected.",
      price!=null ? "A page price was found; verify whether it is the full pack price." : "Price was not reliably detected.",
      quantity ? "A possible package count was found." : "Package count was not detected; enter it manually.",
      "Suggested selling price is intentionally left blank for your team to decide."
    ].join(" ")
  };
}
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  if(req.method==="OPTIONS") return res.status(204).end();
  if(req.method!=="POST") return res.status(405).json({error:"Use POST to extract a product page."});
  try {
    const raw=req.body && req.body.url;
    if(typeof raw!=="string" || raw.length>2000) return res.status(400).json({error:"Provide one product page URL under 2,000 characters."});
    const u=await validatePublicUrl(raw);
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),8000);
    let response;
    try { response=await fetch(u.toString(),{signal:controller.signal,redirect:"follow",headers:{"User-Agent":"Mozilla/5.0 (compatible; FBLASnackBudget/1.0; +product-info-parser)","Accept":"text/html,application/xhtml+xml"}}); }
    finally { clearTimeout(timer); }
    if(!response.ok) return res.status(422).json({error:`The product website returned HTTP ${response.status}. Try a different public product page or enter the item manually.`});
    const type=response.headers.get("content-type")||"";
    if(!type.includes("text/html") && !type.includes("application/xhtml+xml")) return res.status(422).json({error:"That URL did not return an HTML product page."});
    const html=await response.text();
    if(html.length>3_000_000) return res.status(413).json({error:"That product page is too large to process."});
    const result=parsePage(html,u.toString());
    if(!result.name && result.packCost==null && !result.quantity) return res.status(422).json({error:"Couldn't find product details on that page. Some retailers block extraction; you can still add the product manually."});
    return res.status(200).json(result);
  } catch(e) {
    const msg=e.name==="AbortError"?"The product page took too long to respond.":(e.message||"Could not extract product details.");
    return res.status(400).json({error:msg});
  }
};
