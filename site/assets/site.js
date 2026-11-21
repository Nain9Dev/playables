// NainDev Playables: lazy phone embeds, fullscreen, live telemetry and the theme toggle.
(function () {
  "use strict";

  // Theme: follow the system until the visitor chooses, then remember the choice.
  var root = document.documentElement;
  try {
    var saved = localStorage.getItem("playables-theme");
    if (saved === "light" || saved === "dark") root.setAttribute("data-theme", saved);
  } catch (error) { /* storage can be blocked, the system theme still works */ }

  var toggle = document.querySelector(".theme-toggle");
  if (toggle) {
    toggle.addEventListener("click", function () {
      var current = root.getAttribute("data-theme") ||
        (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      var next = current === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("playables-theme", next); } catch (error) { /* ignore */ }
    });
  }

  var frames = [];

  function mount(phone) {
    var screen = phone.querySelector(".phone-screen");
    if (!screen || screen.querySelector("iframe")) return screen && screen.querySelector("iframe");
    var frame = document.createElement("iframe");
    frame.src = phone.getAttribute("data-src");
    frame.title = phone.getAttribute("data-title") || "Playable ad";
    frame.setAttribute("allow", "autoplay; fullscreen; vibrate");
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox");
    screen.appendChild(frame);
    frames.push(frame);
    var cover = phone.querySelector(".phone-play");
    if (cover) cover.remove();
    return frame;
  }

  document.querySelectorAll(".phone").forEach(function (phone) {
    var play = phone.querySelector(".phone-play");
    if (play) play.addEventListener("click", function () { mount(phone); });

    var full = phone.querySelector(".phone-full");
    if (full) {
      full.addEventListener("click", function () {
        var src = phone.getAttribute("data-src");
        var overlay = document.createElement("div");
        overlay.className = "fs-overlay";
        var close = document.createElement("button");
        close.className = "fs-close";
        close.type = "button";
        close.textContent = "Close";
        var frame = document.createElement("iframe");
        frame.src = src;
        frame.title = phone.getAttribute("data-title") || "Playable ad";
        frame.setAttribute("allow", "autoplay; fullscreen; vibrate");
        overlay.appendChild(close);
        overlay.appendChild(frame);
        document.body.appendChild(overlay);
        close.addEventListener("click", function () { overlay.remove(); });
        document.addEventListener("keydown", function onKey(event) {
          if (event.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", onKey); }
        });
      });
    }
  });

  // Live telemetry: the playable posts plain messages, the page lists them.
  var log = document.getElementById("telemetry-log");
  if (log) {
    var clear = document.querySelector(".console-clear");
    var count = 0;
    var first = null;

    if (clear) {
      clear.addEventListener("click", function () {
        log.innerHTML = '<li class="console-empty">Log cleared. Play again to see new events.</li>';
        count = 0;
        first = null;
      });
    }

    window.addEventListener("message", function (event) {
      var data = event.data;
      var known = frames.some(function (frame) { return frame.contentWindow === event.source; });
      if (!known || !data || data.source !== "playable" || typeof data.name !== "string") return;

      if (count === 0) log.innerHTML = "";
      if (first === null) first = data.t;
      count += 1;

      var row = document.createElement("li");
      var time = document.createElement("span");
      time.className = "t";
      time.textContent = ((data.t - first) / 1000).toFixed(2) + "s";
      var name = document.createElement("span");
      name.className = "n" + (data.name === "cta_click" ? " cta" : data.name === "fail" ? " bad" : "");
      name.textContent = data.name;
      var detail = document.createElement("span");
      detail.className = "d";
      detail.textContent = data.data
        ? Object.keys(data.data).map(function (key) { return key + "=" + data.data[key]; }).join("  ")
        : "";
      row.appendChild(time);
      row.appendChild(name);
      row.appendChild(detail);
      log.appendChild(row);
      log.scrollTop = log.scrollHeight;
    });
  }
})();
