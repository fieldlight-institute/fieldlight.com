(function () {
  "use strict";

  const storageKey = "fieldlight-reader-continuity-v1";
  const dataUrl = "/continuity/data.json?v=4";

  function getState() {
    try {
      return JSON.parse(localStorage.getItem(storageKey)) || { read: {}, visits: {} };
    } catch (_) {
      return { read: {}, visits: {} };
    }
  }

  function setState(state) {
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch (_) {}
  }

  function normalizedPath() {
    const path = window.location.pathname.replace(/index\.html$/, "");
    return path.endsWith("/") ? path : path + "/";
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function publicationMap(data) {
    return new Map(data.publications.map((item) => [item.id, item]));
  }

  function ensureStylesheet() {
    if (document.querySelector('link[href*="reader-continuity.css"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/continuity/reader-continuity.css?v=2";
    document.head.appendChild(link);
  }

  function articleRail(data, publication) {
    ensureStylesheet();
    const state = getState();
    state.visits = state.visits || {};
    state.visits[publication.id] = new Date().toISOString();
    setState(state);

    if (document.querySelector('[data-reader-continuity="inline"]')) return;

    const map = publicationMap(data);
    const related = (data.connections || []).filter((item) => item.from === publication.id || item.to === publication.id);

    const rail = el("aside", "reader-continuity-rail");
    rail.setAttribute("aria-label", "Reader continuity");
    const heading = el("div", "reader-continuity-rail-heading");
    heading.append(el("p", "reader-continuity-eyebrow", "Reader continuity"));
    const title = el("h2", "", "Where this work connects.");
    const question = el("p", "reader-continuity-question", related.length
      ? publication.title + " participates in " + related.length + " evidence-backed connection" + (related.length === 1 ? "." : "s.")
      : "This work is registered in the public corpus; a direct evidence connection has not yet been published.");
    heading.append(title, question);

    const actions = el("div", "reader-continuity-actions");
    const marked = Boolean((state.read || {})[publication.id]);
    const markButton = el("button", marked ? "is-read" : "", marked ? "Marked as read ✓" : "Mark as read");
    markButton.type = "button";
    markButton.addEventListener("click", function () {
      const current = getState();
      current.read = current.read || {};
      if (current.read[publication.id]) {
        delete current.read[publication.id];
        markButton.textContent = "Mark as read";
        markButton.classList.remove("is-read");
      } else {
        current.read[publication.id] = new Date().toISOString();
        markButton.textContent = "Marked as read ✓";
        markButton.classList.add("is-read");
      }
      setState(current);
    });
    actions.appendChild(markButton);

    related.slice(0, 3).forEach((connection) => {
      const otherId = connection.from === publication.id ? connection.to : connection.from;
      const other = map.get(otherId);
      const link = el("a", "reader-continuity-direction");
      link.href = other.url;
      link.innerHTML = "<span></span><strong></strong><p></p>";
      link.querySelector("span").textContent = connection.id + " / " + connection.relation;
      link.querySelector("strong").textContent = other.title;
      link.querySelector("p").textContent = connection.claim;
      actions.appendChild(link);
    });
    const mapLink = el("a", "reader-continuity-map-link", "Open the connection map →");
    mapLink.href = "/continuity/#map";
    actions.appendChild(mapLink);
    rail.append(heading, actions);

    const main = document.querySelector("main");
    const pageFooter = document.querySelector("body > footer");
    if (main) main.after(rail);
    else if (pageFooter) pageFooter.before(rail);
    else document.body.appendChild(rail);
  }

  function renderConnectionMap(data) {
    const container = document.getElementById("connection-map");
    if (!container) return;
    const map = publicationMap(data);
    container.textContent = "";

    const stageHeader = el("div", "connection-stage-header");
    stageHeader.appendChild(el("span", "connection-stage-spacer", "Evidence chain"));
    data.mapStages.forEach((stage) => {
      const stageNode = el("div", "connection-stage");
      stageNode.innerHTML = "<span></span><strong></strong><p></p>";
      stageNode.querySelector("span").textContent = stage.number;
      stageNode.querySelector("strong").textContent = stage.title;
      stageNode.querySelector("p").textContent = stage.description;
      stageHeader.appendChild(stageNode);
    });
    container.appendChild(stageHeader);

    data.mapChains.forEach((chain) => {
      const article = el("article", "connection-chain");
      article.id = chain.id;
      const chainHeader = el("header", "connection-chain-heading");
      chainHeader.innerHTML = "<span></span><h3></h3><p></p><i></i>";
      chainHeader.querySelector("span").textContent = chain.number;
      chainHeader.querySelector("h3").textContent = chain.title;
      chainHeader.querySelector("p").textContent = chain.claim;
      chainHeader.querySelector("i").textContent = chain.status;
      article.appendChild(chainHeader);

      chain.cells.forEach((cell, cellIndex) => {
        const stage = data.mapStages.find((item) => item.id === cell.stage);
        const cellNode = el("div", "connection-cell" + (cell.works.length ? "" : " is-gap"));
        cellNode.dataset.stage = stage.title;
        cellNode.innerHTML = "<span class=\"connection-mobile-stage\"></span><div class=\"connection-cell-works\"></div><p class=\"connection-cell-note\"></p>";
        cellNode.querySelector(".connection-mobile-stage").textContent = stage.number + " / " + stage.title;
        const works = cellNode.querySelector(".connection-cell-works");
        if (cell.works.length) {
          cell.works.forEach((publicationId) => {
            const item = map.get(publicationId);
            const link = el("a", "connection-work");
            link.href = item.url;
            link.innerHTML = "<span></span><strong></strong>";
            link.querySelector("span").textContent = item.id;
            link.querySelector("strong").textContent = item.title;
            works.appendChild(link);
          });
        } else {
          works.appendChild(el("strong", "connection-gap", "Open evidence requirement"));
        }
        cellNode.querySelector(".connection-cell-note").textContent = cell.note;
        if (cellIndex < chain.cells.length - 1) cellNode.setAttribute("data-continues", "true");
        article.appendChild(cellNode);
      });
      container.appendChild(article);
    });
  }

  function renderConnectionEvidence(data) {
    const container = document.getElementById("connection-evidence");
    if (!container) return;
    const map = publicationMap(data);
    const heading = el("header", "connection-evidence-heading");
    heading.innerHTML = "<p>Connection ledger</p><h3>Why these lines are drawn.</h3><span></span>";
    heading.querySelector("span").textContent = data.connections.length + " claims / basis + confidence shown";
    container.appendChild(heading);

    data.connections.forEach((connection) => {
      const from = map.get(connection.from);
      const to = map.get(connection.to);
      const article = el("article", "connection-claim");
      article.innerHTML = "<div class=\"connection-claim-meta\"><span></span><i></i></div><h4><a class=\"from\"></a><em></em><a class=\"to\"></a></h4><p class=\"connection-claim-text\"></p><p class=\"connection-claim-basis\"></p>";
      article.querySelector(".connection-claim-meta span").textContent = connection.id;
      article.querySelector(".connection-claim-meta i").textContent = connection.confidence + " confidence";
      article.querySelector("a.from").href = from.url;
      article.querySelector("a.from").textContent = from.title;
      article.querySelector("em").textContent = connection.relation;
      article.querySelector("a.to").href = to.url;
      article.querySelector("a.to").textContent = to.title;
      article.querySelector(".connection-claim-text").textContent = connection.claim;
      article.querySelector(".connection-claim-basis").textContent = "Basis: " + connection.basis;
      container.appendChild(article);
    });
  }

  function renderReaderState(data) {
    const panel = document.getElementById("reader-state");
    if (!panel) return;
    const state = getState();
    const readIds = Object.keys(state.read || {}).filter((id) => data.publications.some((item) => item.id === id));
    const previousContinuityVisit = state.continuityVisitedAt;
    const changes = data.publications.filter((item) => item.changedAt && previousContinuityVisit && new Date(item.changedAt) > new Date(previousContinuityVisit));
    panel.textContent = "";

    const count = el("p", "reader-state-count");
    count.innerHTML = "<strong></strong><span>marked as read on this device</span>";
    count.querySelector("strong").textContent = readIds.length + " / " + data.publications.length;
    panel.appendChild(count);

    if (!previousContinuityVisit) {
      panel.appendChild(el("p", "", "This is your local baseline. Mark a piece as read from any reading surface; your place will be waiting here."));
    } else if (changes.length) {
      const message = el("p", "", changes.length + (changes.length === 1 ? " public piece has" : " public pieces have") + " changed since your last visit.");
      panel.appendChild(message);
      const list = el("ul", "reader-state-changes");
      changes.forEach((item) => {
        const li = el("li");
        const link = el("a", "", item.title);
        link.href = item.url;
        li.appendChild(link);
        list.appendChild(li);
      });
      panel.appendChild(list);
    } else {
      panel.appendChild(el("p", "", "No explicitly recorded public changes since your last visit. The baseline is not being reconstructed from file dates."));
    }

    const privacy = el("p", "reader-state-privacy", "Stored only in this browser. Clear this site's local data to remove it.");
    panel.appendChild(privacy);
    state.continuityVisitedAt = new Date().toISOString();
    setState(state);
  }

  function renderContexts(data) {
    const register = document.getElementById("context-register");
    if (!register) return;
    const publications = new Map(data.publications.map((item) => [item.id, item]));
    data.contexts.forEach((item) => {
      const article = el("article", "context-record");
      article.innerHTML = "<span class=\"context-id\"></span><div><p class=\"context-status\"></p><h3></h3></div><div><p class=\"context-relation\"></p><div class=\"context-results\"><span>Entered public work</span></div></div>";
      article.querySelector(".context-id").textContent = item.id;
      article.querySelector(".context-status").textContent = item.status;
      article.querySelector("h3").textContent = item.title;
      article.querySelector(".context-relation").textContent = item.relation;
      if (item.url) {
        const sourceLink = el("a", "context-source-link", "Inspect public source ↗");
        sourceLink.href = item.url;
        article.children[1].appendChild(sourceLink);
      }
      const results = article.querySelector(".context-results");
      (item.related || []).forEach((id) => {
        const publication = publications.get(id);
        if (!publication) return;
        const link = el("a", "", publication.title);
        link.href = publication.url;
        results.appendChild(link);
      });
      register.appendChild(article);
    });
  }

  function renderPublicationRegister(data) {
    const register = document.getElementById("publication-register");
    if (!register) return;
    const state = getState();
    const threads = new Map(data.threads.map((item) => [item.id, item]));
    register.textContent = "";
    data.publications.forEach((item) => {
      const link = el("a", "publication-record" + ((state.read || {})[item.id] ? " is-read" : ""));
      link.href = item.url;
      link.innerHTML = "<span class=\"publication-id\"></span><div><h3></h3><p></p></div><i aria-hidden=\"true\">→</i>";
      link.querySelector(".publication-id").textContent = item.id;
      link.querySelector("h3").textContent = item.title;
      link.querySelector("p").textContent = item.form + " / " + threads.get(item.primaryThread).title;
      register.appendChild(link);
    });
  }

  fetch(dataUrl)
    .then((response) => {
      if (!response.ok) throw new Error("Continuity data unavailable");
      return response.json();
    })
    .then((data) => {
      if (document.body.classList.contains("continuity-page")) {
        renderReaderState(data);
        renderConnectionMap(data);
        renderConnectionEvidence(data);
        renderContexts(data);
        renderPublicationRegister(data);
        return;
      }
      const path = normalizedPath();
      const publication = data.publications.find((item) => item.url === path);
      if (publication) articleRail(data, publication);
    })
    .catch(() => {});
})();
