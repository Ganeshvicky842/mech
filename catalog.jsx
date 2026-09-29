const catalogTabs = ['All parts', 'Accessories', 'Spare parts', 'Genuine parts'];
const catalogCategories = [
  { name: 'All parts', note: 'Everything your car needs', image: 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=900&q=85', imagePosition: 'center 54%' },
  { name: 'Spare parts', note: 'Workshop-ready replacements', image: 'https://images.unsplash.com/photo-1767339736233-f4b02c41ee4a?auto=format&fit=crop&w=900&q=85', imagePosition: 'center 56%' },
  { name: 'Genuine parts', note: 'Manufacturer-approved quality', image: 'https://toyotahonduras.com/parts/img1.png', imagePosition: 'center' },
  { name: 'Accessories', note: 'Small details, better drives', image: 'https://images.unsplash.com/photo-1772903789023-370243b27258?auto=format&fit=crop&w=900&q=85', imagePosition: 'center 58%' }
];
const productArtwork = {
  'OIL-5W30': 'A smoother-running engine',
  'FLT-OEM-01': 'Engine care essential',
  'BRK-PAD-22': 'Confident stopping power',
  'CAB-FLT-07': 'Breathe easier on every drive',
  'WIP-24-16': 'Clear vision, come rain or shine',
  'BAT-AGM-12': 'Reliable starts, every time'
};
const productPhotoByCategory = {
  'Genuine parts': 'https://toyotahonduras.com/parts/img1.png',
  'Spare parts': 'https://images.unsplash.com/photo-1767339736233-f4b02c41ee4a?auto=format&fit=crop&w=800&q=85',
  'Accessories': 'https://images.unsplash.com/photo-1772903789023-370243b27258?auto=format&fit=crop&w=800&q=85'
};
function PartIllustration({ sku }) {
  const defs = <defs><linearGradient id="part-bg" x2="1" y2="1"><stop stopColor="#203b3d"/><stop offset="1" stopColor="#101e22"/></linearGradient><linearGradient id="part-metal" x2="0" y2="1"><stop stopColor="#f4f1e7"/><stop offset="1" stopColor="#aebbb2"/></linearGradient><linearGradient id="part-accent" x2="1" y2="1"><stop stopColor="#9df0d5"/><stop offset="1" stopColor="#50bba4"/></linearGradient><filter id="part-shadow" x="-.4" y="-.4" width="1.8" height="1.9"><feDropShadow dx="0" dy="9" stdDeviation="7" floodColor="#071012" floodOpacity=".38"/></filter></defs>;
  let art;
  if (sku.startsWith('OIL-')) art = <g filter="url(#part-shadow)"><path d="M94 47h31v13h12v19h16v104q0 10-11 10H74q-11 0-11-10V82q0-9 10-9h21z" fill="#e9eee7"/><path d="M94 47h31v13H94z" fill="#a9d7c3"/><path d="M79 93h64v62H79z" fill="#244c49"/><path d="M80 101h62v8H80z" fill="#eeaa66"/><text x="111" y="128" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="800">5W-30</text><text x="111" y="143" textAnchor="middle" fill="#bce4cf" fontSize="7" letterSpacing="1">FULL SYNTHETIC</text><path d="M140 87h9v7h-9" fill="#aec2b6"/></g>;
  else if (sku === 'FLT-OEM-01') art = <g filter="url(#part-shadow)"><ellipse cx="111" cy="77" rx="44" ry="17" fill="#283b3c"/><path d="M67 77v66q0 17 44 17t44-17V77" fill="#d1d8ce"/><ellipse cx="111" cy="143" rx="44" ry="17" fill="#9eaaa0"/><path d="M72 84v55m10-59v64m10-67v69m10-71v72m10-72v72m10-71v70m10-68v66m10-63v58m10-54v47" stroke="#70847b" strokeWidth="2" opacity=".65"/><ellipse cx="111" cy="77" rx="23" ry="8" fill="#a5e6cc"/><ellipse cx="111" cy="77" rx="11" ry="4" fill="#203b3d"/><path d="M75 170h72" stroke="#f3ae69" strokeWidth="5" strokeLinecap="round"/></g>;
  else if (sku.startsWith('BRK-')) art = <g filter="url(#part-shadow)"><path d="M62 79q0-14 14-14h48l25 21v55l-24 19H77q-15 0-15-15z" fill="#c8d2c8"/><path d="M70 85q0-9 9-9h41l17 15v43l-18 14H79q-9 0-9-9z" fill="#354846"/><path d="M83 90h38l9 8v31l-10 9H82z" fill="#df9760"/><path d="M87 95h30l5 6v25l-6 6H86z" fill="#f1d3aa"/><circle cx="143" cy="111" r="10" fill="#edf0e5"/><circle cx="143" cy="111" r="4" fill="#527269"/><path d="M68 73h53" stroke="#f3ae69" strokeWidth="4" strokeLinecap="round"/></g>;
  else if (sku.startsWith('CAB-')) art = <g filter="url(#part-shadow)"><path d="M63 83q0-11 11-11h76v82q0 10-10 10H63z" fill="#e2e6dc"/><path d="M76 85h10v68H76zm16 0h8v68h-8zm15 0h8v68h-8zm15 0h8v68h-8zm15 0h8v68h-8z" fill="#92c9b1"/><path d="M72 76h79v8H72zM69 157h82v8H69z" fill="#657d73"/><path d="M59 94h6v54h-6zm95-5h7v63h-7z" fill="#f1ae6a"/></g>;
  else if (sku.startsWith('WIP-')) art = <g filter="url(#part-shadow)"><path d="M59 141q9-61 61-70 28-5 51 11-26-1-43 13-20 16-25 47-24 12-44-1z" fill="#dce4d9"/><path d="M61 147q9-60 64-75" fill="none" stroke="#a4e6cc" strokeWidth="8" strokeLinecap="round"/><path d="M97 145q12-57 64-76" fill="none" stroke="#81928a" strokeWidth="8" strokeLinecap="round"/><circle cx="86" cy="113" r="7" fill="#f3ae69"/><circle cx="125" cy="107" r="7" fill="#f3ae69"/><path d="M57 157h112" stroke="#dfe6db" strokeOpacity=".34"/></g>;
  else art = <g filter="url(#part-shadow)"><rect x="65" y="77" width="91" height="82" rx="9" fill="#e2e9de"/><rect x="73" y="88" width="75" height="61" rx="5" fill="#344a46"/><rect x="83" y="69" width="20" height="14" rx="3" fill="#d5ddd1"/><rect x="119" y="69" width="20" height="14" rx="3" fill="#eaa56b"/><text x="110" y="116" textAnchor="middle" fill="#b9ead3" fontSize="13" fontWeight="800">12V</text><text x="110" y="133" textAnchor="middle" fill="#e6ede2" fontSize="7" letterSpacing="1">AGM POWER</text><path d="M78 150h64" stroke="#9fe6cb" strokeWidth="3"/></g>;
  return <svg className="part-illustration" viewBox="0 0 220 220" role="img" aria-label={`${sku} automotive part illustration`}>{defs}<rect width="220" height="220" rx="14" fill="url(#part-bg)"/><circle cx="174" cy="48" r="45" fill="#72cdb0" opacity=".09"/><circle cx="38" cy="185" r="58" fill="#edaa70" opacity=".08"/><path d="M22 187h176" stroke="#fff" strokeOpacity=".12"/><path d="M28 35h24m-12-12v24" stroke="#9ce8ce" strokeOpacity=".5" strokeWidth="2"/>{art}<text x="183" y="197" textAnchor="end" fill="#d4e7dd" opacity=".65" fontSize="7" letterSpacing="1.4">WRENCH / PARTS</text></svg>;
}
function ProductPhoto({ product }) {
  const [imageFailed, setImageFailed] = React.useState(false);
  const src = productPhotoByCategory[product.category];
  return imageFailed || !src
    ? <PartIllustration sku={product.sku}/>
    : <img className="product-photo" src={src} alt={`${product.name} automotive part`} loading="lazy" onError={() => setImageFailed(true)}/>;
}
function PartsStore() {
  const [category, setCategory] = React.useState('All parts');
  const [query, setQuery] = React.useState('');
  const [cart, setCart] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('wrench_cart')) || {}; } catch { return {}; }
  });
  const [stock, setStock] = React.useState([]);
  const [catalogError, setCatalogError] = React.useState('');
  const [orderPending, setOrderPending] = React.useState(false);
  React.useEffect(() => {
    window.wrenchApi.request('/api/catalog').then(items => { setStock(items); setCatalogError(''); }).catch(error => setCatalogError(error.message));
  }, []);
  const products = stock.map(item => ({ ...item, tagline: productArtwork[item.sku] || 'Workshop-tested quality' }));
  const shown = products.filter(p => (category === 'All parts' || p.category === category) && `${p.name} ${p.brand} ${p.sku}`.toLowerCase().includes(query.toLowerCase()));
  const cartCount = Object.values(cart).reduce((total, qty) => total + qty, 0);
  const cartTotal = products.reduce((total, product) => total + (cart[product.sku] || 0) * product.price, 0);
  function updateCart(sku, change) {
    const current = cart[sku] || 0;
    const next = { ...cart, [sku]: Math.max(0, current + change) };
    if (!next[sku]) delete next[sku];
    setCart(next);
    localStorage.setItem('wrench_cart', JSON.stringify(next));
  }
  async function requestOrder() {
    if (!cartCount || orderPending) return;
    let customer;
    try { customer = JSON.parse(localStorage.getItem('wrench_customer') || 'null'); } catch { customer = null; }
    const name = customer?.name || window.prompt('Your name for the parts request:');
    if (!name) return;
    const phone = customer?.phone || window.prompt('Your mobile number:');
    if (!phone) return;
    setOrderPending(true);
    try {
      const result = await window.wrenchApi.send('/api/part-orders', 'POST', { name, phone, items: Object.entries(cart).map(([sku, quantity]) => ({ sku, quantity })) });
      setCart({});
      try { localStorage.setItem('wrench_cart', '{}'); } catch (error) { window.alert(`Request ${result.id} is saved, but this browser could not clear its saved basket: ${error.message}`); }
      window.alert(`Parts request ${result.id} has been saved. Your request is with the workshop; call 1800 555 0123 to confirm fitment and arrange collection.`);
      try {
        setStock(await window.wrenchApi.request('/api/catalog'));
      } catch (error) {
        window.alert(`Request ${result.id} is saved, but the catalogue could not refresh: ${error.message}. Reload this page to see current stock.`);
      }
    } catch (error) {
      window.alert(`${error.message}\n\nPlease review your basket and try again, or call 1800 555 0123.`);
    } finally {
      setOrderPending(false);
    }
  }
  return <>
    <div className="parts-store-intro">
      <div><div className="eyebrow"><span></span> THE WRENCH PARTS COUNTER</div><h2>The right parts.<br/><em>Right here.</em></h2><p>Genuine parts, dependable spares and thoughtful accessories for the road ahead.</p></div>
      <div className="store-promise"><span className="store-promise-icon">✳</span><div><strong>Good parts make great drives.</strong><small>Quality checked by the team who’ll fit them.</small></div><button className="store-cart" onClick={() => document.getElementById('parts-basket').scrollIntoView({ behavior: 'smooth', block: 'nearest' })}>Basket <span>{cartCount}</span></button></div>
    </div>
    <div className="store-tools"><div className="store-tabs" role="tablist" aria-label="Browse parts categories">{catalogTabs.map(tab => <button key={tab} role="tab" aria-selected={category === tab} className={category === tab ? 'selected' : ''} onClick={() => setCategory(tab)}>{tab}</button>)}</div><label className="store-search"><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search parts or brands" aria-label="Search parts or brands"/></label></div>
    <div className="store-result-label product-result-label">{category === 'All parts' ? 'ALL PARTS' : category.toUpperCase()} <span>· {shown.length} parts</span></div>
    <div className="parts-product-grid">{shown.map(product => <article className="parts-product name-only-product" key={product.sku}><div className="product-nameplate"><strong>{product.name}</strong><small>PART NO. {product.sku}</small></div><div className="product-copy"><div className="product-brand">{product.brand} <span>· Workshop checked</span></div><p>{product.tagline}</p><div className="product-buy"><strong>₹{Number(product.price).toLocaleString('en-IN')}</strong>{cart[product.sku] ? <div className="quantity-stepper"><button aria-label={`Remove one ${product.name}`} onClick={() => updateCart(product.sku, -1)}>−</button><span>{cart[product.sku]}</span><button aria-label={`Add one ${product.name}`} onClick={() => updateCart(product.sku, 1)}>+</button></div> : <button className="product-add" onClick={() => updateCart(product.sku, 1)} aria-label={`Add ${product.name} to basket`}>+ <span>Add</span></button>}</div></div></article>)}</div>
    {catalogError && <div className="parts-empty">The parts catalogue could not be loaded: {catalogError}</div>}
    {!catalogError && !shown.length && <div className="parts-empty">No parts match this search. Try another term or category.</div>}
    <div className="parts-basket" id="parts-basket"><div><span className="basket-eyebrow">YOUR PARTS BASKET</span><strong>{cartCount ? `${cartCount} ${cartCount === 1 ? 'item' : 'items'} · ₹${cartTotal.toLocaleString('en-IN')}` : 'Ready when you are'}</strong><small>{cartCount ? 'We’ll confirm fitment and availability before you pay.' : 'Add a part above and we’ll help you with fitment.'}</small></div><button className="button button-primary" disabled={!cartCount || orderPending} onClick={requestOrder}>{orderPending ? 'Sending request…' : 'Request these parts'} <span>↗</span></button></div>
  </>;
}
const catalogRoot = document.getElementById('parts-store-root');
if (catalogRoot) ReactDOM.createRoot(catalogRoot).render(<PartsStore/>);
