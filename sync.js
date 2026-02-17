const fs = require("fs");

const PAGE_URL = process.env.PAGE_URL;

if (!PAGE_URL) {
  console.error("Missing PAGE_URL env var.");
  process.exit(1);
}

async function fetchText(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return await res.text();
}

/* --------------------------------------------------
   1️⃣ Webflow CSS URL finden
-------------------------------------------------- */
function findWebflowCSSUrl(html) {
  const matches = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)]
    .map(m => m[1]);

  if (!matches.length) {
    throw new Error("No CSS links found in page");
  }

  const filtered = matches.filter(url =>
    !url.includes("google") &&
    !url.includes("gstatic")
  );

  const sorted = filtered.sort((a, b) => b.length - a.length);
  return sorted[0];
}

/* --------------------------------------------------
   2️⃣ CSS Variablen extrahieren
-------------------------------------------------- */
function extractCSSVariables(cssText) {
  const vars = {};
  const rootMatch = cssText.match(/:root\s*\{([\s\S]*?)\}/);

  if (!rootMatch) return vars;

  const varMatches = [...rootMatch[1].matchAll(/--([^:]+):\s*([^;]+);/g)];

  varMatches.forEach(m => {
    vars[`--${m[1].trim()}`] = m[2].trim();
  });

  return vars;
}

/* --------------------------------------------------
   3️⃣ Selektoren sammeln (Klassen + Tags getrennt)
-------------------------------------------------- */
function extractSelectors(cssText) {

  const classSelectors = [...new Set(
    [...cssText.matchAll(/\.([a-zA-Z0-9_-]+)(?![\w-])/g)]
      .map(m => m[1])
  )];

  const tagWhitelist = new Set([
    "h1","h2","h3","h4","h5","h6",
    "p","a","button","input","textarea",
    "select","label","ul","ol","li"
  ]);

  const tagSelectors = [...new Set(
    [...cssText.matchAll(/(^|[}\s,])([a-z][a-z0-9-]*)\s*\{/gi)]
      .map(m => m[2].toLowerCase())
      .filter(t => tagWhitelist.has(t))
  )];

  return { classSelectors, tagSelectors };
}

/* --------------------------------------------------
   4️⃣ CSS Regeln extrahieren (inkl. Media Split)
-------------------------------------------------- */
function extractRelevantCSS(cssText, classSelectors, tagSelectors) {

  const components = {};
  [...classSelectors, ...tagSelectors].forEach(s => (components[s] = []));

  const classHit = (selector, cls) =>
    new RegExp(`\\.${cls}(?![\\w-])`).test(selector);

  const tagHit = (selector, tag) =>
    new RegExp(`(^|\\s|,)${tag}(\\s|\\{|:|\\.|#|\\[)`).test(selector);

  /* ---- Normale Regeln ---- */
  const ruleRegex = /([^{@}][^{]*?)\{([^}]*)\}/g;
  let m;

  while ((m = ruleRegex.exec(cssText)) !== null) {
    const selector = m[1].trim();
    const body = m[2].trim();
    if (!selector || !body) continue;

    for (const cls of classSelectors) {
      if (classHit(selector, cls)) {
        components[cls].push(`${selector} {\n${body}\n}`);
      }
    }

    for (const tag of tagSelectors) {
      if (tagHit(selector, tag)) {
        components[tag].push(`${selector} {\n${body}\n}`);
      }
    }
  }

  /* ---- Media Queries sauber splitten ---- */
  const mediaOuter = /@media[^{]+\{([\s\S]+?)\}\s*\}/g;
  let mm;

  while ((mm = mediaOuter.exec(cssText)) !== null) {

    const condition = mm[0].match(/@media[^{]+/)[0];
    const innerCSS = mm[1];

    const innerRules = [...innerCSS.matchAll(/([^{]+)\{([^}]+)\}/g)];

    for (const r of innerRules) {

      const sel = r[1].trim();
      const body = r[2].trim();

      for (const cls of classSelectors) {
        if (classHit(sel, cls)) {
          components[cls].push(
`${condition} {
${sel} {
${body}
}
}`
          );
        }
      }

      for (const tag of tagSelectors) {
        if (tagHit(sel, tag)) {
          components[tag].push(
`${condition} {
${sel} {
${body}
}
}`
          );
        }
      }
    }
  }

  return components;
}

/* --------------------------------------------------
   5️⃣ CSS Variablen auflösen
-------------------------------------------------- */
function resolveVariables(components, variables) {

  Object.keys(components).forEach(key => {
    components[key] = components[key].map(rule => {

      Object.keys(variables).forEach(v => {
        const value = variables[v];
        rule = rule.replace(new RegExp(`var\\(${v}\\)`, "g"), value);
      });

      return rule;
    });
  });

  return components;
}

/* --------------------------------------------------
   6️⃣ Hauptprozess
-------------------------------------------------- */
(async () => {
  try {

    console.log("🌍 Fetching page:", PAGE_URL);
    const html = await fetchText(PAGE_URL);

    const cssUrl = findWebflowCSSUrl(html);
    console.log("🎨 CSS URL:", cssUrl);

    const css = await fetchText(cssUrl);
    fs.writeFileSync("latest.css", css, "utf8");

    const variables = extractCSSVariables(css);
    console.log(`🎛 ${Object.keys(variables).length} CSS variables found`);

    const { classSelectors, tagSelectors } = extractSelectors(css);
    console.log(`📦 ${classSelectors.length} classes found`);
    console.log(`📦 ${tagSelectors.length} tags found`);

    let components = extractRelevantCSS(css, classSelectors, tagSelectors);
    components = resolveVariables(components, variables);

    fs.writeFileSync(
      "components.json",
      JSON.stringify(components, null, 2),
      "utf8"
    );

    console.log("✔ Updated components.json");

  } catch (err) {
    console.error("❌ Sync failed:", err.message);
    process.exit(1);
  }
})();
