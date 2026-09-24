// Deterministic, evidence-backed checks. Each check reads `ctx`
// ({ s: signals, css: cssMetrics, x: extras }) and returns
//   { v: 0..1 | null (not applicable), issue?, strength? }
// Text fields are [en, ko]; the pipeline resolves them to the report language.
// `w` is the check's weight inside its category's rule score.

const I = (severity, priority, title, impact, why, rec, detail, confidence = 'high', view = null) => ({ severity, priority, title, impact, why, rec, detail, confidence, view });
const S = (title, detail = '') => ({ title, detail });
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 100);

export const RULES = [
  // ── SEO ───────────────────────────────────────────────────
  { id: 'seo.title', cat: 'seo', w: 3, run: ({ s }) => {
    const n = s.title.length;
    if (!n) return { v: 0, issue: I('high', 'P1', ['Page has no <title>', '페이지에 <title>이 없음'], ['Search results and browser tabs show a URL instead of a name, which lowers click-through.', '검색 결과와 브라우저 탭에 이름 대신 URL이 표시되어 클릭률이 떨어집니다.'], ['The document head contains no title element.', '문서 head에 title 요소가 없습니다.'], ['Add a unique 30–60 character title that leads with the page topic, followed by the brand.', '페이지 주제를 앞에 두고 브랜드를 뒤에 붙인 30~60자 고유 title을 추가하세요.'], 'No <title> element found') };
    if (n < 15 || n > 65) return { v: 0.6, issue: I('low', 'P3', ['Title length is outside the recommended range', 'Title 길이가 권장 범위를 벗어남'], ['Search engines may truncate or rewrite the title shown in results.', '검색엔진이 결과에 표시되는 제목을 자르거나 다시 쓸 수 있습니다.'], [`The title is ${n} characters long.`, `제목이 ${n}자입니다.`], ['Keep the title between 30 and 60 characters and put the most specific words first.', '제목을 30~60자로 맞추고 가장 구체적인 단어를 앞에 두세요.'], `"${s.title.slice(0, 90)}" (${n} chars)`) };
    return { v: 1, strength: S(['Descriptive page title', '명확한 페이지 제목'], `"${s.title}"`) };
  } },
  { id: 'seo.meta_description', cat: 'seo', w: 2, run: ({ s }) => {
    const n = s.metaDescription.length;
    if (!n) return { v: 0.2, issue: I('medium', 'P2', ['Missing meta description', 'Meta description 누락'], ['Search engines pick a random text fragment as the snippet, which is often unconvincing.', '검색엔진이 임의의 문장을 스니펫으로 사용해 설득력이 떨어질 수 있습니다.'], ['No <meta name="description"> is present.', '<meta name="description">이 없습니다.'], ['Write a 120–160 character description that states what the page offers and who it is for.', '이 페이지가 무엇을, 누구에게 제공하는지 담은 120~160자 설명을 작성하세요.'], 'meta[name=description] not found') };
    if (n < 70 || n > 170) return { v: 0.7, issue: I('low', 'P3', ['Meta description length is not optimal', 'Meta description 길이가 최적이 아님'], ['Short descriptions waste snippet space; long ones get cut off.', '짧으면 스니펫 공간을 낭비하고, 길면 잘립니다.'], [`The description is ${n} characters.`, `설명이 ${n}자입니다.`], ['Aim for 120–160 characters with a clear benefit and action.', '명확한 혜택과 행동을 담아 120~160자로 맞추세요.'], `${n} chars`) };
    return { v: 1 };
  } },
  { id: 'seo.h1', cat: 'seo', w: 2.5, run: ({ s }) => {
    if (s.h1Count === 0) return { v: 0, issue: I('high', 'P1', ['No H1 heading on the page', '페이지에 H1 제목이 없음'], ['Visitors and search engines lack a clear statement of what the page is about.', '방문자와 검색엔진이 페이지 주제를 명확히 파악하기 어렵습니다.'], ['The main headline is not marked up as <h1>, or does not exist.', '메인 헤드라인이 <h1>으로 마크업되지 않았거나 없습니다.'], ['Mark up the primary headline as a single <h1> that states the core value in plain words.', '핵심 가치를 평이한 말로 전하는 메인 헤드라인 하나를 <h1>으로 지정하세요.'], '0 × <h1>') };
    if (s.h1Count > 1) return { v: 0.7, issue: I('low', 'P3', ['Multiple H1 headings', 'H1 제목이 여러 개'], ['The primary topic of the page becomes ambiguous.', '페이지의 핵심 주제가 모호해집니다.'], [`${s.h1Count} <h1> elements were found.`, `<h1>이 ${s.h1Count}개 발견되었습니다.`], ['Keep one <h1> for the page topic and demote the others to <h2>.', '페이지 주제에 해당하는 <h1> 하나만 남기고 나머지는 <h2>로 바꾸세요.'], `${s.h1Count} × <h1>`) };
    return { v: 1, strength: S(['Single, clear H1', '명확한 단일 H1'], `"${s.h1Text}"`) };
  } },
  { id: 'seo.heading_order', cat: 'seo', w: 1, run: ({ s }) => {
    if (s.headings.length < 3) return { v: s.headings.length ? 0.6 : 0.3 };
    if (s.headingSkips > 0) return { v: 0.6, issue: I('low', 'P3', ['Heading levels skip steps', '제목 단계가 건너뛰어짐'], ['Screen reader users and crawlers lose the document outline.', '스크린리더 사용자와 크롤러가 문서 구조를 파악하기 어렵습니다.'], [`Heading levels jump (e.g. H2 → H4) ${s.headingSkips} time(s).`, `제목 단계가 ${s.headingSkips}회 건너뜁니다(예: H2 → H4).`], ['Use heading levels for structure, not size; style visually with CSS.', '제목 단계는 크기가 아닌 구조로 사용하고, 시각적 크기는 CSS로 조정하세요.'], `${s.headingSkips} skipped level(s)`) };
    return { v: 1 };
  } },
  { id: 'seo.indexable', cat: 'seo', w: 3, run: ({ s }) => {
    if (/noindex/i.test(s.robotsMeta)) return { v: 0, issue: I('critical', 'P1', ['Page is set to noindex', '페이지가 noindex로 설정됨'], ['The page will not appear in search results.', '이 페이지는 검색 결과에 노출되지 않습니다.'], ['<meta name="robots"> contains "noindex".', '<meta name="robots">에 "noindex"가 포함되어 있습니다.'], ['Remove noindex if this page should be discoverable.', '검색 노출이 필요하다면 noindex를 제거하세요.'], s.robotsMeta) };
    return { v: 1 };
  } },
  { id: 'seo.canonical', cat: 'seo', w: 1, run: ({ s }) => s.canonical ? { v: 1 } : { v: 0.5, issue: I('low', 'P3', ['No canonical URL', 'Canonical URL 없음'], ['Duplicate URLs (tracking parameters, trailing slashes) can split ranking signals.', '중복 URL(추적 파라미터 등)로 검색 순위 신호가 분산될 수 있습니다.'], ['<link rel="canonical"> is not set.', '<link rel="canonical">이 없습니다.'], ['Add a self-referencing canonical link to every indexable page.', '색인 대상 페이지마다 자기 참조 canonical을 추가하세요.'], 'link[rel=canonical] not found') } },
  { id: 'seo.crawl_files', cat: 'seo', w: 1, run: ({ x }) => {
    const miss = [!x.robotsTxt && 'robots.txt', !x.sitemap && 'sitemap.xml'].filter(Boolean);
    if (!miss.length) return { v: 1 };
    return { v: miss.length === 2 ? 0.4 : 0.7, issue: I('low', 'P3', ['Crawler files are missing', '크롤러용 파일 누락'], ['Search engines discover new pages more slowly.', '검색엔진이 새 페이지를 더 느리게 발견합니다.'], [`Not found: ${miss.join(', ')}.`, `찾을 수 없음: ${miss.join(', ')}.`], ['Publish robots.txt with a Sitemap: line and an XML sitemap listing canonical URLs.', 'Sitemap: 줄이 포함된 robots.txt와 canonical URL을 나열한 XML 사이트맵을 게시하세요.'], miss.join(', '), 'medium') };
  } },
  { id: 'seo.social', cat: 'seo', w: 1, run: ({ s }) => {
    const miss = [!s.og.title && 'og:title', !s.og.image && 'og:image', !s.og.description && 'og:description'].filter(Boolean);
    if (!miss.length) return { v: 1 };
    return { v: 1 - miss.length * 0.25, issue: I('low', 'P3', ['Incomplete social sharing tags', '소셜 공유 태그 불완전'], ['Links shared in messengers and social feeds render without a proper preview.', '메신저·SNS 공유 시 미리보기가 제대로 표시되지 않습니다.'], [`Missing: ${miss.join(', ')}.`, `누락: ${miss.join(', ')}.`], ['Add Open Graph title, description and a 1200×630 image.', 'Open Graph 제목·설명과 1200×630 이미지를 추가하세요.'], miss.join(', ')) };
  } },
  { id: 'seo.structured_data', cat: 'seo', w: 1.5, run: ({ s }) => s.jsonLdTypes.length
    ? { v: 1, strength: S(['Structured data present', '구조화 데이터 적용'], s.jsonLdTypes.join(', ')) }
    : { v: 0.4, issue: I('medium', 'P2', ['No structured data', '구조화 데이터 없음'], ['The site misses rich results and gives search engines less certainty about what it is.', '리치 결과 기회를 놓치고, 검색엔진이 사이트 정체를 확신하기 어렵습니다.'], ['No JSON-LD blocks were found.', 'JSON-LD 블록이 없습니다.'], ['Add JSON-LD for Organization and WebSite, plus Product, Article or FAQPage where relevant.', 'Organization·WebSite JSON-LD를 추가하고, 해당 시 Product·Article·FAQPage도 추가하세요.'], 'script[type="application/ld+json"] not found') } },

  // ── Accessibility ─────────────────────────────────────────
  { id: 'a11y.lang', cat: 'accessibility', w: 1.5, run: ({ s }) => s.lang ? { v: 1 } : { v: 0, issue: I('medium', 'P2', ['Page language is not declared', '페이지 언어가 선언되지 않음'], ['Screen readers may read the content with the wrong pronunciation.', '스크린리더가 잘못된 발음으로 읽을 수 있습니다.'], ['<html> has no lang attribute.', '<html>에 lang 속성이 없습니다.'], ['Set <html lang="…"> to the primary content language.', '<html lang="…">을 주 언어로 지정하세요.'], '<html> without lang') } },
  { id: 'a11y.alt', cat: 'accessibility', w: 3, run: ({ s }) => {
    const { total, withAlt } = s.images;
    if (!total) return { v: null };
    const p = pct(withAlt, total);
    if (p >= 95) return { v: 1, strength: S(['Images carry alt text', '이미지 대체 텍스트 적용'], `${withAlt}/${total}`) };
    const sev = p < 50 ? 'high' : 'medium';
    return { v: p / 100, issue: I(sev, sev === 'high' ? 'P1' : 'P2', ['Images are missing alt text', '이미지 대체 텍스트 누락'], ['Blind users hear file names or nothing; image search cannot index them.', '시각장애 사용자는 파일명을 듣거나 아무 정보도 얻지 못하고, 이미지 검색에서도 제외됩니다.'], [`${total - withAlt} of ${total} images have no alt attribute.`, `이미지 ${total}개 중 ${total - withAlt}개에 alt 속성이 없습니다.`], ['Describe informative images in alt; use alt="" for purely decorative ones.', '정보를 담은 이미지는 alt로 설명하고, 장식용 이미지는 alt=""로 두세요.'], `${withAlt}/${total} images with alt (${p}%)`) };
  } },
  { id: 'a11y.form_labels', cat: 'accessibility', w: 2.5, run: ({ s }) => {
    if (!s.forms.fields) return { v: null };
    if (!s.forms.unlabeled) return { v: 1 };
    return { v: 1 - s.forms.unlabeled / s.forms.fields, issue: I('high', 'P1', ['Form fields without labels', '레이블 없는 입력 필드'], ['Screen reader users cannot tell what to enter; placeholder text disappears while typing.', '스크린리더 사용자는 무엇을 입력할지 알 수 없고, placeholder는 입력 중 사라집니다.'], [`${s.forms.unlabeled} of ${s.forms.fields} fields have no associated label.`, `입력 필드 ${s.forms.fields}개 중 ${s.forms.unlabeled}개에 연결된 레이블이 없습니다.`], ['Pair each field with a visible <label for="…">, or aria-label when a visible label is impossible.', '각 필드에 보이는 <label for="…">을 연결하고, 불가능하면 aria-label을 사용하세요.'], `${s.forms.unlabeled}/${s.forms.fields} unlabeled`) };
  } },
  { id: 'a11y.names', cat: 'accessibility', w: 2, run: ({ s }) => {
    const n = s.links.unnamed + s.buttons.unnamed;
    if (!n) return { v: 1 };
    return { v: Math.max(0.2, 1 - n / 10), issue: I('medium', 'P2', ['Links or buttons without an accessible name', '접근 가능한 이름이 없는 링크·버튼'], ['Assistive technology announces them only as "link" or "button".', '보조기기가 단순히 "링크", "버튼"이라고만 읽습니다.'], [`${s.links.unnamed} link(s) and ${s.buttons.unnamed} button(s) have no text or aria-label.`, `링크 ${s.links.unnamed}개, 버튼 ${s.buttons.unnamed}개에 텍스트나 aria-label이 없습니다.`], ['Add visible text or an aria-label to icon-only controls.', '아이콘만 있는 컨트롤에 텍스트나 aria-label을 추가하세요.'], `${n} unnamed controls`) };
  } },
  { id: 'a11y.landmarks', cat: 'accessibility', w: 1, run: ({ s }) => {
    const miss = [!s.landmarks.main && '<main>', !s.landmarks.nav && '<nav>'].filter(Boolean);
    if (!miss.length) return { v: 1 };
    return { v: 1 - miss.length * 0.35, issue: I('low', 'P3', ['Missing page landmarks', '페이지 랜드마크 누락'], ['Keyboard and screen reader users cannot jump directly to main content or navigation.', '키보드·스크린리더 사용자가 본문이나 내비게이션으로 바로 이동할 수 없습니다.'], [`Missing: ${miss.join(', ')}.`, `누락: ${miss.join(', ')}.`], ['Wrap primary content in <main> and menus in <nav>; add a skip link.', '본문은 <main>, 메뉴는 <nav>로 감싸고 건너뛰기 링크를 추가하세요.'], miss.join(', ')) };
  } },
  { id: 'a11y.zoom', cat: 'accessibility', w: 2, run: ({ s }) => s.zoomDisabled ? { v: 0, issue: I('high', 'P1', ['Pinch-zoom is disabled', '확대(핀치 줌)가 비활성화됨'], ['Low-vision users on mobile cannot enlarge text.', '저시력 모바일 사용자가 글자를 확대할 수 없습니다.'], ['The viewport meta tag sets user-scalable=no or maximum-scale=1.', 'viewport 메타 태그가 user-scalable=no 또는 maximum-scale=1로 설정되어 있습니다.'], ['Remove user-scalable=no and maximum-scale from the viewport tag.', 'viewport 태그에서 user-scalable=no와 maximum-scale을 제거하세요.'], s.viewport) } : { v: s.viewport ? 1 : null } },
  { id: 'a11y.focus', cat: 'accessibility', w: 2, run: ({ css }) => {
    if (css.outlineNone && !css.focusVisible) return { v: 0.3, issue: I('medium', 'P2', ['Focus outlines are removed', '포커스 표시가 제거됨'], ['Keyboard users lose track of where they are on the page.', '키보드 사용자가 현재 위치를 알 수 없습니다.'], ['CSS sets outline: none on focusable elements without a :focus-visible replacement.', 'CSS가 포커스 가능한 요소의 outline을 제거하고 :focus-visible 대체 스타일이 없습니다.'], ['Provide a visible :focus-visible style with at least 3:1 contrast.', '대비 3:1 이상의 :focus-visible 스타일을 제공하세요.'], `${css.outlineNone} outline:none rule(s)`, 'medium') };
    return { v: css.focusVisible || css.focus ? 1 : 0.7 };
  } },
  { id: 'a11y.contrast', cat: 'accessibility', w: 2.5, run: ({ css }) => {
    const pairs = css.contrastPairs;
    if (!pairs.length) return { v: null };
    const fails = pairs.filter((p) => p.ratio < 4.5);
    if (!fails.length) return { v: 1 };
    const worst = fails.sort((a, b) => a.ratio - b.ratio)[0];
    const sev = worst.ratio < 3 ? 'high' : 'medium';
    return { v: Math.max(0.2, 1 - fails.length / pairs.length), issue: I(sev, sev === 'high' ? 'P1' : 'P2', ['Text color contrast below WCAG AA', '텍스트 대비가 WCAG AA 미달'], ['Text is hard to read for low-vision users and on bright screens.', '저시력 사용자와 밝은 화면에서 글자를 읽기 어렵습니다.'], [`${fails.length} of ${pairs.length} color pairs declared in CSS fall below 4.5:1 (worst ${worst.ratio}:1).`, `CSS에 선언된 색상 쌍 ${pairs.length}개 중 ${fails.length}개가 4.5:1 미만입니다(최저 ${worst.ratio}:1).`], ['Darken text or lighten backgrounds until body text reaches 4.5:1 and large text 3:1.', '본문 4.5:1, 큰 글자 3:1 이상이 되도록 글자색 또는 배경색을 조정하세요.'], `${worst.sel}: ${worst.fg} on ${worst.bg} = ${worst.ratio}:1`, 'medium') };
  } },
  { id: 'a11y.tabindex', cat: 'accessibility', w: 0.5, run: ({ s }) => s.tabindexPositive ? { v: 0.5, issue: I('low', 'P3', ['Positive tabindex values', '양수 tabindex 사용'], ['Keyboard focus order no longer follows the visual order.', '키보드 포커스 순서가 시각적 순서와 달라집니다.'], [`${s.tabindexPositive} element(s) use tabindex > 0.`, `${s.tabindexPositive}개 요소가 tabindex > 0을 사용합니다.`], ['Use tabindex="0" or reorder the DOM instead.', 'tabindex="0"을 쓰거나 DOM 순서를 조정하세요.'], `${s.tabindexPositive} × tabindex>0`) } : { v: 1 } },
  { id: 'a11y.motion', cat: 'accessibility', w: 0.5, run: ({ css }) => {
    if (!css.animations) return { v: null };
    return css.reducedMotion ? { v: 1 } : { v: 0.6, issue: I('low', 'P3', ['Animations ignore reduced-motion preference', '모션 감소 설정을 무시하는 애니메이션'], ['Users with vestibular disorders may feel discomfort.', '전정기관 장애가 있는 사용자가 불편을 느낄 수 있습니다.'], [`${css.animations} animation declaration(s), no prefers-reduced-motion query.`, `애니메이션 선언 ${css.animations}개, prefers-reduced-motion 쿼리 없음.`], ['Wrap non-essential motion in @media (prefers-reduced-motion: no-preference).', '필수가 아닌 모션을 @media (prefers-reduced-motion: no-preference)로 감싸세요.'], 'no prefers-reduced-motion', 'medium') };
  } },

  // ── Responsive ────────────────────────────────────────────
  { id: 'resp.viewport', cat: 'responsive', w: 3, run: ({ s }) => /width\s*=\s*device-width/i.test(s.viewport) ? { v: 1 } : { v: 0, issue: I('critical', 'P1', ['No mobile viewport', '모바일 viewport 미설정'], ['Phones render the desktop layout zoomed out, making text unreadable without zooming.', '휴대폰이 데스크톱 레이아웃을 축소해 보여주므로 확대 없이는 글을 읽기 어렵습니다.'], ['The viewport meta tag is missing or lacks width=device-width.', 'viewport 메타 태그가 없거나 width=device-width가 없습니다.'], ['Add <meta name="viewport" content="width=device-width, initial-scale=1">.', '<meta name="viewport" content="width=device-width, initial-scale=1">을 추가하세요.'], s.viewport || 'meta[name=viewport] not found', 'high', 'mobile') } },
  { id: 'resp.media', cat: 'responsive', w: 2, run: ({ css, x }) => {
    if (!x.cssFetched) return { v: null };
    if (css.widthMediaQueries >= 2) return { v: 1, strength: S(['Layout adapts with breakpoints', '브레이크포인트 기반 반응형 레이아웃'], `${css.widthMediaQueries} width media queries`) };
    if (css.widthMediaQueries === 1) return { v: 0.7 };
    return { v: 0.3, issue: I('high', 'P1', ['No responsive breakpoints detected', '반응형 브레이크포인트가 감지되지 않음'], ['The layout likely does not adapt between desktop, tablet and phone.', '데스크톱·태블릿·모바일 간 레이아웃이 적응하지 않을 가능성이 높습니다.'], ['The analyzed CSS contains no width-based @media queries.', '분석한 CSS에 너비 기반 @media 쿼리가 없습니다.'], ['Define breakpoints (e.g. 640/1024px) and stack columns, resize type and simplify navigation on small screens.', '브레이크포인트(예: 640/1024px)를 정의하고 작은 화면에서 컬럼 쌓기, 글자 크기 조정, 내비게이션 단순화를 적용하세요.'], '0 width-based @media', 'medium', 'mobile') };
  } },
  { id: 'resp.fixed_width', cat: 'responsive', w: 1, run: ({ css, x }) => {
    if (!x.cssFetched) return { v: null };
    if (!css.fixedWidths.length) return { v: 1 };
    const f = css.fixedWidths[0];
    return { v: 0.5, issue: I('medium', 'P2', ['Fixed pixel widths cause horizontal overflow', '고정 픽셀 너비로 가로 넘침 발생 가능'], ['Mobile users must scroll sideways to read content.', '모바일 사용자가 옆으로 스크롤해야 합니다.'], [`${css.fixedWidths.length} rule(s) set width ≥ 1024px (e.g. ${f.sel} → ${f.px}px).`, `${css.fixedWidths.length}개 규칙이 1024px 이상의 고정 너비를 사용합니다(예: ${f.sel} → ${f.px}px).`], ['Replace fixed widths with max-width plus width: 100%.', '고정 너비를 max-width와 width: 100% 조합으로 바꾸세요.'], `${f.sel} { width: ${f.px}px }`, 'medium', 'mobile') };
  } },
  { id: 'resp.images', cat: 'responsive', w: 1, run: ({ s }) => {
    if (s.images.total < 3) return { v: null };
    if (s.images.srcset) return { v: 1 };
    return { v: 0.5, issue: I('low', 'P3', ['Images are not responsive', '이미지가 반응형이 아님'], ['Phones download desktop-sized images, slowing the page.', '휴대폰이 데스크톱 크기 이미지를 내려받아 느려집니다.'], ['No srcset or <picture> sources were found.', 'srcset 또는 <picture> 소스가 없습니다.'], ['Serve multiple sizes with srcset and sizes.', 'srcset과 sizes로 여러 크기를 제공하세요.'], `0/${s.images.total} images with srcset`) };
  } },

  // ── Performance ───────────────────────────────────────────
  { id: 'perf.ttfb', cat: 'performance', w: 2, run: ({ s }) => {
    if (s.ttfb <= 800) return { v: 1, strength: S(['Fast server response', '빠른 서버 응답'], `${s.ttfb} ms`) };
    if (s.ttfb <= 1800) return { v: 0.7 };
    return { v: 0.3, issue: I('medium', 'P2', ['Slow server response', '느린 서버 응답'], ['Every visit starts with a noticeable blank wait.', '방문할 때마다 눈에 띄는 빈 화면 대기가 발생합니다.'], [`Time to first byte was ${s.ttfb} ms from our auditor.`, `감사 서버 기준 첫 바이트까지 ${s.ttfb}ms가 걸렸습니다.`], ['Enable CDN/edge caching for HTML and check slow backend queries.', 'HTML에 CDN/엣지 캐싱을 적용하고 느린 백엔드 쿼리를 점검하세요.'], `TTFB ${s.ttfb} ms (single sample)`, 'medium') };
  } },
  { id: 'perf.html_size', cat: 'performance', w: 1, run: ({ s }) => {
    const kb = Math.round(s.htmlBytes / 1024);
    if (kb <= 250) return { v: 1 };
    const sev = kb > 800 ? 'high' : 'medium';
    return { v: kb > 800 ? 0.3 : 0.6, issue: I(sev, 'P2', ['Heavy HTML document', '무거운 HTML 문서'], ['Slower first render, especially on mobile networks.', '특히 모바일 네트워크에서 첫 렌더링이 느려집니다.'], [`The HTML is ${kb} KB, often from inlined data or scripts.`, `HTML이 ${kb}KB이며, 인라인 데이터나 스크립트가 원인인 경우가 많습니다.`], ['Move inline data and scripts to cacheable files; paginate long lists.', '인라인 데이터와 스크립트를 캐시 가능한 파일로 분리하고, 긴 목록은 페이지로 나누세요.'], `${kb} KB HTML, ${Math.round(s.scripts.inlineBytes / 1024)} KB inline script`) };
  } },
  { id: 'perf.render_blocking', cat: 'performance', w: 2, run: ({ s }) => {
    const n = s.scripts.renderBlocking;
    if (!n) return { v: 1 };
    return { v: Math.max(0.2, 1 - n * 0.15), issue: I(n > 3 ? 'high' : 'medium', 'P2', ['Render-blocking scripts in <head>', '<head>의 렌더링 차단 스크립트'], ['The browser waits for these scripts before showing anything.', '브라우저가 이 스크립트를 받을 때까지 화면을 그리지 않습니다.'], [`${n} external script(s) in <head> lack async or defer.`, `<head>의 외부 스크립트 ${n}개에 async/defer가 없습니다.`], ['Add defer to scripts that are not needed for first paint.', '첫 화면에 필요 없는 스크립트에 defer를 추가하세요.'], `${n} blocking <script src>`) };
  } },
  { id: 'perf.requests', cat: 'performance', w: 1.5, run: ({ s }) => {
    const n = s.requestCount;
    if (n <= 50) return { v: 1 };
    return { v: n > 100 ? 0.4 : 0.7, issue: I(n > 100 ? 'medium' : 'low', n > 100 ? 'P2' : 'P3', ['Many resource requests', '많은 리소스 요청'], ['More requests mean more round trips before the page is usable.', '요청이 많을수록 사용 가능해지기까지 왕복 시간이 늘어납니다.'], [`${n} scripts, stylesheets, images and iframes are referenced in the HTML.`, `HTML에서 스크립트·스타일·이미지·iframe ${n}개를 참조합니다.`], ['Bundle scripts, remove unused third-party tags and lazy-load below-the-fold media.', '스크립트를 번들링하고, 불필요한 서드파티 태그를 제거하며, 아래쪽 미디어는 지연 로딩하세요.'], `${n} referenced resources (${s.scripts.external} JS, ${s.stylesheets.length} CSS, ${s.images.total} img)`, 'medium') };
  } },
  { id: 'perf.lazy', cat: 'performance', w: 1, run: ({ s }) => {
    if (s.images.total < 6) return { v: null };
    if (s.images.lazy >= Math.min(3, s.images.total - 3)) return { v: 1 };
    return { v: 0.5, issue: I('low', 'P3', ['Images are not lazy-loaded', '이미지 지연 로딩 미적용'], ['Off-screen images compete with visible content for bandwidth.', '화면 밖 이미지가 보이는 콘텐츠와 대역폭을 다툽니다.'], [`${s.images.lazy} of ${s.images.total} images use loading="lazy".`, `이미지 ${s.images.total}개 중 ${s.images.lazy}개만 loading="lazy"를 사용합니다.`], ['Add loading="lazy" to images below the first screen.', '첫 화면 아래 이미지에 loading="lazy"를 추가하세요.'], `${s.images.lazy}/${s.images.total} lazy`) };
  } },
  { id: 'perf.image_weight', cat: 'performance', w: 2, run: ({ s, x }) => {
    if (!x.imageSizes?.length) return { v: s.images.total && !s.images.modern && s.images.total > 3 ? 0.7 : null };
    const heavy = x.imageSizes.filter((i) => i.bytes > 400 * 1024);
    if (!heavy.length) return { v: s.images.modern ? 1 : 0.85 };
    const top = heavy.sort((a, b) => b.bytes - a.bytes)[0];
    return { v: Math.max(0.2, 1 - heavy.length / x.imageSizes.length), issue: I('medium', 'P2', ['Oversized images', '과도하게 큰 이미지'], ['Large images dominate load time on mobile connections.', '큰 이미지가 모바일 연결에서 로딩 시간을 지배합니다.'], [`${heavy.length} of ${x.imageSizes.length} sampled images exceed 400 KB (largest ${Math.round(top.bytes / 1024)} KB).`, `샘플 이미지 ${x.imageSizes.length}개 중 ${heavy.length}개가 400KB를 넘습니다(최대 ${Math.round(top.bytes / 1024)}KB).`], ['Compress, resize to display size and serve WebP/AVIF.', '압축하고, 표시 크기로 줄이고, WebP/AVIF로 제공하세요.'], `${top.url.slice(-80)} — ${Math.round(top.bytes / 1024)} KB`) };
  } },
  { id: 'perf.fonts', cat: 'performance', w: 0.5, run: ({ s, css }) => {
    if (!s.fonts.googleFonts && !css.fontFaces) return { v: null };
    if (s.fonts.googleSwap || css.fontDisplay) return { v: 1 };
    return { v: 0.5, issue: I('low', 'P3', ['Web fonts may block text', '웹폰트가 텍스트 표시를 막을 수 있음'], ['Text stays invisible until the font file arrives.', '폰트 파일이 도착할 때까지 텍스트가 보이지 않습니다.'], ['No font-display rule or display=swap parameter was found.', 'font-display 규칙이나 display=swap 파라미터가 없습니다.'], ['Use font-display: swap and preload the primary font.', 'font-display: swap을 쓰고 주 폰트를 preload하세요.'], 'font-display missing', 'medium') };
  } },

  // ── Typography ────────────────────────────────────────────
  { id: 'type.families', cat: 'typography', w: 2, run: ({ css, x }) => {
    if (!x.cssFetched) return { v: null };
    const fams = [...css.fontFamilies].filter((f) => !/^(inherit|initial|var\(|monospace|sans-serif|serif|system-ui|-apple-system|emoji|icon|font ?awesome|material)/.test(f));
    if (fams.length <= 3) return { v: 1, strength: fams.length ? S(['Restrained typeface selection', '절제된 서체 선택'], fams.join(', ')) : null };
    return { v: fams.length > 5 ? 0.4 : 0.7, issue: I('medium', 'P2', ['Too many typefaces', '서체가 너무 많음'], ['The page feels inconsistent and loads more font files.', '페이지가 일관성 없어 보이고 폰트 파일도 더 많이 받습니다.'], [`${fams.length} font families are declared.`, `서체 ${fams.length}종이 선언되어 있습니다.`], ['Limit to one or two families and build hierarchy with size and weight.', '서체를 1~2종으로 제한하고 크기와 굵기로 위계를 만드세요.'], fams.slice(0, 8).join(', '), 'medium') };
  } },
  { id: 'type.scale', cat: 'typography', w: 1.5, run: ({ css, x }) => {
    if (!x.cssFetched || !css.fontSizes.size) return { v: null };
    const n = css.fontSizes.size;
    if (n <= 10) return { v: 1 };
    return { v: n > 20 ? 0.4 : 0.7, issue: I('low', 'P3', ['No consistent type scale', '일관된 타입 스케일 부재'], ['Headings and body text lack a clear, repeatable hierarchy.', '제목과 본문에 명확하고 반복 가능한 위계가 없습니다.'], [`${n} distinct font-size values are used.`, `서로 다른 font-size 값이 ${n}개 사용됩니다.`], ['Define 5–7 size tokens (e.g. a 1.25 ratio scale) and use only those.', '5~7개의 크기 토큰(예: 1.25 비율 스케일)을 정의하고 그것만 사용하세요.'], `${n} font-size values`, 'medium') };
  } },
  { id: 'type.units', cat: 'typography', w: 0.5, run: ({ css, x }) => {
    const t = css.relFontSizes + css.absFontSizes;
    if (!x.cssFetched || t < 5) return { v: null };
    return { v: css.relFontSizes / t >= 0.5 ? 1 : 0.6 };
  } },

  // ── Color ─────────────────────────────────────────────────
  { id: 'color.palette', cat: 'color', w: 2, run: ({ css, x }) => {
    if (!x.cssFetched) return { v: null };
    const n = css.colors.size;
    if (n <= 16) return { v: 1, strength: n ? S(['Controlled color palette', '통제된 컬러 팔레트'], `${n} distinct colors`) : null };
    return { v: n > 40 ? 0.4 : 0.7, issue: I('low', 'P3', ['Fragmented color palette', '분산된 컬러 팔레트'], ['Near-duplicate colors weaken brand recognition and make maintenance harder.', '비슷한 색이 난립해 브랜드 인지도가 약해지고 유지보수가 어려워집니다.'], [`${n} distinct color values appear in the CSS.`, `CSS에 서로 다른 색상 값이 ${n}개 있습니다.`], ['Consolidate into a token palette: primary, secondary, accent, neutrals and semantic states.', '주·보조·강조·중립·상태 색으로 이뤄진 토큰 팔레트로 정리하세요.'], `${n} colors`, 'medium') };
  } },
  { id: 'color.tokens', cat: 'color', w: 1, run: ({ css, x }) => {
    if (!x.cssFetched) return { v: null };
    return css.colorTokens >= 4 ? { v: 1 } : { v: 0.6 };
  } },

  // ── UI ────────────────────────────────────────────────────
  { id: 'ui.consistency', cat: 'ui', w: 2, run: ({ css, x }) => {
    if (!x.cssFetched) return { v: null };
    const r = css.radii.size, sh = css.shadows.size;
    if (r <= 5 && sh <= 5) return { v: 1 };
    return { v: r + sh > 20 ? 0.4 : 0.7, issue: I('low', 'P3', ['Inconsistent component styling', '일관성 없는 컴포넌트 스타일'], ['Buttons and cards look like they belong to different products.', '버튼과 카드가 서로 다른 제품처럼 보입니다.'], [`${r} different border-radius and ${sh} different box-shadow values.`, `border-radius ${r}종, box-shadow ${sh}종이 사용됩니다.`], ['Define radius and elevation tokens (e.g. 3 radii, 2 shadows) and apply them by component role.', 'radius·elevation 토큰(예: radius 3종, shadow 2종)을 정의하고 컴포넌트 역할별로 적용하세요.'], `radius ×${r}, shadow ×${sh}`, 'medium') };
  } },
  { id: 'ui.states', cat: 'ui', w: 1.5, run: ({ css, x }) => {
    if (!x.cssFetched) return { v: null };
    if (css.hover && (css.focus || css.focusVisible)) return { v: 1 };
    return { v: 0.5, issue: I('low', 'P3', ['Interactive states are incomplete', '인터랙션 상태 정의 불완전'], ['Controls give little feedback when pointed at or focused.', '포인터나 포커스를 올려도 컨트롤이 반응을 거의 보이지 않습니다.'], [`Found ${css.hover ? '' : 'no '}:hover and ${css.focus || css.focusVisible ? '' : 'no '}:focus styles.`, `:hover ${css.hover ? '있음' : '없음'}, :focus ${css.focus || css.focusVisible ? '있음' : '없음'}.`], ['Design hover, focus, active and disabled states for buttons, links and inputs.', '버튼·링크·입력에 hover, focus, active, disabled 상태를 설계하세요.'], 'state selectors', 'medium') };
  } },
  { id: 'ui.spacing', cat: 'ui', w: 1, run: ({ css, x }) => {
    if (!x.cssFetched || css.spacings.size < 4) return { v: null };
    return { v: css.spacings.size <= 14 ? 1 : css.spacings.size <= 28 ? 0.7 : 0.45 };
  } },
  { id: 'ui.tokens', cat: 'ui', w: 1, run: ({ css, x }) => {
    if (!x.cssFetched) return { v: null };
    return css.customProps >= 8 ? { v: 1, strength: S(['Design tokens in CSS', 'CSS 디자인 토큰 사용'], `${css.customProps} custom properties`) } : { v: 0.6 };
  } },

  // ── Information architecture ─────────────────────────────
  { id: 'ia.nav', cat: 'ia', w: 2.5, run: ({ s }) => {
    if (!s.landmarks.nav && !s.navLinks.length) return { v: 0.2, issue: I('high', 'P1', ['No identifiable primary navigation', '식별 가능한 주 내비게이션 없음'], ['Visitors cannot see where else they can go.', '방문자가 다른 곳으로 어떻게 이동할지 알 수 없습니다.'], ['No <nav> element or header link group was found.', '<nav> 요소나 헤더 링크 그룹이 없습니다.'], ['Add a primary navigation with 4–7 clearly named top-level destinations.', '명확한 이름의 최상위 메뉴 4~7개로 주 내비게이션을 구성하세요.'], 'no <nav>, no header links', 'medium') };
    const n = s.navLinks.length;
    if (n > 9) return { v: 0.6, issue: I('medium', 'P2', ['Primary navigation is overloaded', '주 내비게이션 항목 과다'], ['Too many equal choices slow decisions and bury key pages.', '동등한 선택지가 너무 많아 결정이 느려지고 핵심 페이지가 묻힙니다.'], [`The primary navigation exposes ${n} links.`, `주 내비게이션에 링크 ${n}개가 노출됩니다.`], ['Group related pages and keep 5–7 top-level items; move the rest to the footer.', '관련 페이지를 묶어 최상위 항목을 5~7개로 줄이고 나머지는 푸터로 옮기세요.'], s.navLinks.slice(0, 12).join(' | ')) };
    return { v: 1, strength: n >= 3 ? S(['Focused primary navigation', '간결한 주 내비게이션'], s.navLinks.join(' | ')) : null };
  } },
  { id: 'ia.footer', cat: 'ia', w: 1, run: ({ s }) => (s.landmarks.footer && s.footerLinks.length >= 3 ? { v: 1 } : { v: 0.5, issue: I('low', 'P3', ['Thin footer navigation', '빈약한 푸터 내비게이션'], ['Visitors who scroll to the end find no next step.', '끝까지 스크롤한 방문자가 다음 행동을 찾지 못합니다.'], [`Footer contains ${s.footerLinks.length} link(s).`, `푸터에 링크가 ${s.footerLinks.length}개 있습니다.`], ['Use the footer for secondary navigation, contact, legal and social links.', '푸터를 보조 내비게이션, 연락처, 법적 고지, SNS 링크에 활용하세요.'], `${s.footerLinks.length} footer links`, 'medium') }) },
  { id: 'ia.findability', cat: 'ia', w: 1, run: ({ s }) => (s.links.internal > 80 && !s.search ? { v: 0.6, issue: I('low', 'P3', ['Large site without search', '규모에 비해 검색 기능 없음'], ['Visitors looking for something specific must browse page by page.', '특정 정보를 찾는 방문자가 페이지를 일일이 탐색해야 합니다.'], [`${s.links.internal} internal links but no search field.`, `내부 링크 ${s.links.internal}개에 검색 입력이 없습니다.`], ['Add site search in the header.', '헤더에 사이트 검색을 추가하세요.'], 'no search input', 'medium') } : { v: 1 }) },

  // ── UX ────────────────────────────────────────────────────
  { id: 'ux.link_text', cat: 'ux', w: 1, run: ({ s }) => (s.links.generic.length >= 2 ? { v: 0.6, issue: I('low', 'P3', ['Vague link text', '모호한 링크 문구'], ['Users scanning the page cannot predict where links go.', '페이지를 훑는 사용자가 링크 목적지를 예측할 수 없습니다.'], [`${s.links.generic.length} links use generic text such as "${s.links.generic[0]}".`, `링크 ${s.links.generic.length}개가 "${s.links.generic[0]}" 같은 일반 문구를 사용합니다.`], ['Name the destination: "See pricing plans" instead of "Learn more".', '"더보기" 대신 "요금제 보기"처럼 목적지를 드러내세요.'], s.links.generic.join(' | ')) } : { v: 1 }) },
  { id: 'ux.dead_links', cat: 'ux', w: 1, run: ({ s }) => (s.links.emptyHash > 3 ? { v: 0.6, issue: I('low', 'P3', ['Placeholder links', '빈 링크(#)'], ['Clicks that go nowhere erode trust.', '아무 곳으로도 가지 않는 클릭이 신뢰를 떨어뜨립니다.'], [`${s.links.emptyHash} links point to "#" or nothing.`, `링크 ${s.links.emptyHash}개가 "#"이거나 비어 있습니다.`], ['Link to real destinations or use <button> for in-page actions.', '실제 목적지로 연결하거나, 페이지 내 동작은 <button>을 사용하세요.'], `${s.links.emptyHash} × href="#"`) } : { v: 1 }) },
  { id: 'ux.new_tabs', cat: 'ux', w: 0.5, run: ({ s }) => (s.links.blankNoopener > 0 ? { v: 0.7 } : { v: 1 }) },

  // ── Conversion ────────────────────────────────────────────
  { id: 'conv.cta', cat: 'conversion', w: 3, run: ({ s }) => {
    if (!s.ctas.length) return { v: 0.1, issue: I('high', 'P1', ['No clear call to action', '명확한 행동 유도(CTA) 없음'], ['Interested visitors have no obvious next step.', '관심 있는 방문자에게 분명한 다음 단계가 없습니다.'], ['No button or link with action wording (start, buy, book, contact…) was found.', '행동 문구(시작, 구매, 예약, 문의 등)를 가진 버튼이나 링크가 없습니다.'], ['Add one primary CTA that names the outcome, e.g. "Book a free consultation".', '"무료 상담 예약하기"처럼 결과를 명시한 주 CTA 하나를 추가하세요.'], '0 CTA candidates', 'medium') };
    return { v: 1 };
  } },
  { id: 'conv.cta_early', cat: 'conversion', w: 2, run: ({ s }) => {
    if (!s.ctas.length) return { v: null };
    const first = Math.min(...s.ctas.map((c) => c.pos));
    if (first <= 0.3) return { v: 1, strength: S(['CTA appears early', 'CTA가 초반에 노출됨'], `"${s.ctas.find((c) => c.pos === first).text}"`) };
    return { v: 0.5, issue: I('medium', 'P2', ['Primary CTA appears late in the page', '주 CTA가 페이지 후반에 등장'], ['Visitors who do not scroll never see the next step.', '스크롤하지 않는 방문자는 다음 단계를 보지 못합니다.'], [`The first action element appears ${Math.round(first * 100)}% into the document.`, `첫 행동 요소가 문서의 ${Math.round(first * 100)}% 지점에 나타납니다.`], ['Place the primary CTA in the first screen, next to the value proposition.', '주 CTA를 첫 화면의 가치 제안 옆에 배치하세요.'], `first CTA at ${Math.round(first * 100)}% of markup`, 'medium') };
  } },
  { id: 'conv.cta_competition', cat: 'conversion', w: 1, run: ({ s }) => {
    const early = [...new Set(s.ctas.filter((c) => c.pos <= 0.25).map((c) => c.text.toLowerCase()))];
    if (early.length <= 3) return { v: early.length ? 1 : null };
    return { v: 0.6, issue: I('medium', 'P2', ['Competing calls to action', '경쟁하는 CTA'], ['Several equal-weight actions dilute attention from the main goal.', '비슷한 비중의 행동이 여러 개라 주요 목표에 대한 주의가 분산됩니다.'], [`${early.length} different action labels appear near the top.`, `상단 영역에 서로 다른 행동 문구 ${early.length}개가 있습니다.`], ['Keep one primary CTA; style the rest as secondary or move them lower.', '주 CTA는 하나만 두고 나머지는 보조 스타일로 바꾸거나 아래로 옮기세요.'], early.slice(0, 6).join(' | '), 'medium') };
  } },
  { id: 'conv.social_proof', cat: 'conversion', w: 1.5, run: ({ s }) => (s.socialProof ? { v: 1, strength: S(['Social proof present', '사회적 증거 제시'], '') } : { v: 0.4, issue: I('medium', 'P2', ['No visible social proof', '사회적 증거가 보이지 않음'], ['First-time visitors have little reason to trust the offer.', '처음 방문한 사람이 제안을 신뢰할 근거가 부족합니다.'], ['No testimonials, reviews, client names or ratings were detected in the text.', '본문에서 후기, 리뷰, 고객사, 평점을 찾지 못했습니다.'], ['Add 2–3 specific testimonials or recognizable client logos near the main CTA.', '주 CTA 근처에 구체적인 후기 2~3개나 알아볼 수 있는 고객사 로고를 추가하세요.'], 'no social-proof keywords', 'medium') }) },
  { id: 'conv.form_length', cat: 'conversion', w: 1, run: ({ s }) => {
    if (!s.forms.count) return { v: null };
    if (s.forms.maxFields <= 6) return { v: 1 };
    return { v: 0.5, issue: I('medium', 'P2', ['Long form', '긴 입력 양식'], ['Each additional field lowers the share of people who finish.', '필드가 늘어날수록 완료하는 사람의 비율이 줄어듭니다.'], [`The longest form has ${s.forms.maxFields} fields.`, `가장 긴 양식에 필드가 ${s.forms.maxFields}개 있습니다.`], ['Ask only what is needed now; collect the rest after the first conversion.', '지금 꼭 필요한 것만 묻고 나머지는 첫 전환 이후에 받으세요.'], `${s.forms.maxFields} fields`) };
  } },
  { id: 'conv.trust', cat: 'conversion', w: 1.5, run: ({ s }) => {
    if (!s.https) return { v: 0, issue: I('critical', 'P1', ['Site is not served over HTTPS', 'HTTPS 미적용'], ['Browsers label the site "Not secure" and many visitors leave.', '브라우저가 "안전하지 않음"으로 표시해 많은 방문자가 이탈합니다.'], ['The final URL uses http://.', '최종 URL이 http://입니다.'], ['Install a TLS certificate and redirect all HTTP traffic to HTTPS.', 'TLS 인증서를 설치하고 모든 HTTP 요청을 HTTPS로 리디렉션하세요.'], s.finalUrl) };
    const miss = [!s.privacyLink && 'privacy policy', !s.contactLink && 'contact'].filter(Boolean);
    if (!miss.length) return { v: 1 };
    return { v: 0.6, issue: I('low', 'P3', ['Missing trust basics', '신뢰 기본 요소 누락'], ['Visitors look for a way to reach you and see how their data is handled.', '방문자는 연락 방법과 데이터 처리 방식을 확인하려 합니다.'], [`Not found: ${miss.join(', ')}.`, `찾을 수 없음: ${miss.join(', ')}.`], ['Link contact details and a privacy policy from the footer.', '푸터에 연락처와 개인정보 처리방침 링크를 두세요.'], miss.join(', '), 'medium') };
  } },

  // ── Content ───────────────────────────────────────────────
  { id: 'content.depth', cat: 'content', w: 2, run: ({ s }) => {
    if (s.wordCount >= 250) return { v: 1 };
    return { v: s.wordCount < 80 ? 0.3 : 0.6, issue: I('medium', 'P2', ['Very little readable text', '읽을 수 있는 텍스트가 매우 적음'], ['Visitors and search engines get little information to judge the offer.', '방문자와 검색엔진이 제안을 판단할 정보가 부족합니다.'], [`About ${s.wordCount} words are present in the initial HTML.`, `초기 HTML에 약 ${s.wordCount}단어가 있습니다.`], ['Explain what you offer, for whom, how it works and why it is different.', '무엇을, 누구에게, 어떻게 제공하며 무엇이 다른지 설명하세요.'], `${s.wordCount} words`, s.appShell ? 'low' : 'medium') };
  } },
  { id: 'content.readability', cat: 'content', w: 1.5, run: ({ s }) => {
    if (s.wordCount < 120 || !s.avgSentenceWords) return { v: null };
    if (s.avgSentenceWords <= 22) return { v: 1 };
    return { v: s.avgSentenceWords > 30 ? 0.5 : 0.75, issue: I('low', 'P3', ['Long sentences reduce readability', '긴 문장으로 가독성 저하'], ['Scanning visitors skip dense copy.', '훑어보는 방문자는 빽빽한 글을 건너뜁니다.'], [`Average sentence length is ${s.avgSentenceWords} words.`, `평균 문장 길이가 ${s.avgSentenceWords}단어입니다.`], ['Keep sentences under ~20 words and lead paragraphs with the key point.', '문장을 20단어 안팎으로 줄이고 문단 첫머리에 핵심을 두세요.'], `${s.avgSentenceWords} words/sentence`, 'medium') };
  } },
  { id: 'content.structure', cat: 'content', w: 1, run: ({ s }) => {
    if (s.wordCount < 300) return { v: null };
    const per = s.wordCount / Math.max(1, s.headings.length);
    if (per <= 300 && !s.longParagraphs) return { v: 1 };
    return { v: 0.6, issue: I('low', 'P3', ['Dense content blocks', '빽빽한 콘텐츠 블록'], ['Key points are hard to find when scanning.', '훑어볼 때 핵심을 찾기 어렵습니다.'], [`~${Math.round(per)} words per heading; ${s.longParagraphs} paragraph(s) exceed 120 words.`, `제목당 약 ${Math.round(per)}단어, 120단어 넘는 문단 ${s.longParagraphs}개.`], ['Break content with descriptive subheadings every 150–300 words and shorten paragraphs.', '150~300단어마다 설명적인 소제목을 넣고 문단을 짧게 나누세요.'], `${Math.round(per)} words/heading`, 'medium') };
  } },

  // ── AEO (answer engines) ─────────────────────────────────
  { id: 'aeo.entity', cat: 'aeo', w: 2, run: ({ s }) => {
    const hasOrg = s.jsonLdTypes.some((t) => /Organization|LocalBusiness|Corporation|Person|Brand/i.test(t));
    if (hasOrg) return { v: 1, strength: S(['Entity defined in structured data', '구조화 데이터로 엔티티 정의'], s.jsonLdTypes.join(', ')) };
    return { v: 0.3, issue: I('medium', 'P2', ['Organization identity is not machine-readable', '조직 정보가 기계 판독 불가'], ['AI assistants may misattribute or omit the brand when answering questions.', 'AI 어시스턴트가 답변 시 브랜드를 잘못 연결하거나 누락할 수 있습니다.'], ['No Organization, LocalBusiness or Person JSON-LD was found.', 'Organization·LocalBusiness·Person JSON-LD가 없습니다.'], ['Publish Organization JSON-LD with name, logo, url, sameAs profiles and contact point.', 'name, logo, url, sameAs, contactPoint를 담은 Organization JSON-LD를 게시하세요.'], 'no entity schema') };
  } },
  { id: 'aeo.qa', cat: 'aeo', w: 1.5, run: ({ s }) => (s.faqPresent ? { v: 1 } : { v: 0.4, issue: I('low', 'P3', ['No question-and-answer content', '질문-답변 형식 콘텐츠 없음'], ['Answer engines prefer content that directly answers common questions.', '답변 엔진은 흔한 질문에 직접 답하는 콘텐츠를 선호합니다.'], ['No FAQ section, question headings or FAQPage schema detected.', 'FAQ 섹션, 질문형 제목, FAQPage 스키마가 없습니다.'], ['Add an FAQ answering 5–8 real customer questions in 1–3 sentences each, marked up as FAQPage.', '실제 고객 질문 5~8개에 1~3문장으로 답하는 FAQ를 만들고 FAQPage로 마크업하세요.'], 'no FAQ signals', 'medium') }) },
  { id: 'aeo.trust', cat: 'aeo', w: 1.5, run: ({ s }) => {
    const have = [s.aboutLink && 'about', s.contactLink && 'contact', (s.author || s.published) && 'author/date', s.privacyLink && 'privacy'].filter(Boolean);
    if (have.length >= 3) return { v: 1 };
    return { v: 0.35 + have.length * 0.2, issue: I('low', 'P3', ['Few trust and provenance signals', '신뢰·출처 신호 부족'], ['Answer engines weigh who stands behind the content.', '답변 엔진은 콘텐츠의 주체를 중요하게 봅니다.'], [`Found: ${have.join(', ') || 'none'}.`, `발견: ${have.join(', ') || '없음'}.`], ['Link an About page, named authors with dates, and contact details.', '회사 소개 페이지, 작성자·날짜, 연락처를 연결하세요.'], have.join(', ') || 'none', 'medium') };
  } },
  { id: 'aeo.clarity', cat: 'aeo', w: 1, run: ({ s }) => {
    const name = (s.og.siteName || '').toLowerCase();
    const ok = s.h1Text && s.metaDescription && (!name || s.title.toLowerCase().includes(name));
    return { v: ok ? 1 : 0.6 };
  } },

  // ── Brand ─────────────────────────────────────────────────
  { id: 'brand.logo', cat: 'brand', w: 2, run: ({ s }) => (s.logo || s.svgCount ? { v: 1 } : { v: 0.4, issue: I('medium', 'P2', ['No identifiable logo', '식별 가능한 로고 없음'], ['Visitors may not remember whose site they visited.', '방문자가 어느 브랜드 사이트였는지 기억하지 못할 수 있습니다.'], ['No image, class or SVG referencing a logo was found.', '로고를 가리키는 이미지, 클래스, SVG를 찾지 못했습니다.'], ['Place the logo top-left, linking to home, with alt text containing the brand name.', '홈으로 연결되는 로고를 좌상단에 두고 alt에 브랜드명을 넣으세요.'], 'no logo signal', 'low') }) },
  { id: 'brand.assets', cat: 'brand', w: 1, run: ({ s }) => {
    const miss = [!s.favicon && 'favicon', !s.og.image && 'og:image', !s.themeColor && 'theme-color'].filter(Boolean);
    if (!miss.length) return { v: 1 };
    return { v: 1 - miss.length * 0.2, issue: miss.includes('favicon') ? I('low', 'P3', ['Brand assets missing from browser and share surfaces', '브라우저·공유 화면용 브랜드 에셋 누락'], ['Tabs, bookmarks and shared links show generic icons.', '탭, 북마크, 공유 링크에 일반 아이콘이 표시됩니다.'], [`Missing: ${miss.join(', ')}.`, `누락: ${miss.join(', ')}.`], ['Add a favicon set, an Open Graph image and a theme-color.', '파비콘 세트, OG 이미지, theme-color를 추가하세요.'], miss.join(', ')) : undefined };
  } },
  { id: 'brand.naming', cat: 'brand', w: 1, run: ({ s }) => {
    const name = (s.og.siteName || '').trim();
    if (!name) return { v: 0.75 };
    return { v: s.title.toLowerCase().includes(name.toLowerCase()) ? 1 : 0.7 };
  } },
];

export function runRules(ctx) {
  const results = [];
  for (const r of RULES) {
    let out;
    try { out = r.run(ctx) || { v: null }; } catch (e) { out = { v: null, error: String(e?.message || e) }; }
    results.push({ id: r.id, cat: r.cat, w: r.w, ...out });
  }
  return results;
}
