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
   1️⃣ CSS URL finden
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
   3️⃣ Selektoren sammeln (Klassen + Tags)
-------------------------------------------------- */
function extractAllSelectors(cssText) {

  const classMatches = [...cssText.matchAll(/\.([a-zA-Z0-9_-]+)[\s\.\:\{]/g)]
    .map(m => m[1]);

  const tagMatches = [...cssText.matchAll(/(^|\s|\}|,)(h[1-6]|p|input|textarea|button|a|ul|ol|li|div|span)\s*\{/gi)]
    .map(m => m[2].toLowerCase());

  return [...new Set([...classMatches, ...tagMatches])];
}

/* --------------------------------------------------
   4️⃣ CSS Regeln extrahieren + Media sauber splitten
-------------------------------------------------- */
function extractRelevantCSS(cssText, selectors) {

  const components = {};
  selectors.forEach(s => (components[s] = []));

  // Normale Regeln
  const ruleRegex = /([^{@}][^{]*?)\{([^}]*)\}/g;
  let m;

  while ((m = ruleRegex.exec(cssText)) !== null) {
    const selector = m[1].trim();
    const body = m[2].trim();
    if (!selector || !body) continue;

    selectors.forEach(s => {
      const isClass = selector.includes("." + s);
      const isTag = selector.match(new RegExp(`(^|\\s|,)${s}(\\s|\\{|:)`));

      if (isClass || isTag) {
        components[s].push(`${selector} {\n${body}\n}`);
      }
    });
  }

  // Media Queries sauber zerlegen
  const mediaRegex = /@media[^{]+\{([\s\S]+?)\}\s*\}/g;
  let mediaMatch;

  while ((mediaMatch = mediaRegex.exec(cssText)) !== null) {
    const condition = mediaMatch[0].match(/@media[^{]+/)[0];
    const innerCSS = mediaMatch[1];

    const innerRules = [...innerCSS.matchAll(/([^{]+)\{([^}]+)\}/g)];

    innerRules.forEach(rule => {
      const selector = rule[1].trim();
      const body = rule[2].trim();

      selectors.forEach(s => {
        const isClass = selector.includes("." + s);
        const isTag = selector.match(new RegExp(`(^|\\s|,)${s}(\\s|\\{|:)`));

        if (isClass || isTag) {
          components[s].push(
`${condition} {
${selector} {
${body}
}
}`
          );
        }
      });
    });
  }

  return components;
}

/* --------------------------------------------------
   5️⃣ Variablen auflösen
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

    const selectors = extractAllSelectors(css);
    console.log(`📦 ${selectors.length} selectors found`);

    let components = extractRelevantCSS(css, selectors);
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
