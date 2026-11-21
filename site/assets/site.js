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

  // Only one playable runs at a time: starting one puts the others back behind their cover,
  // so sound and CPU belong to what the visitor is playing.
  // Put a phone back behind its cover. A phone the visitor is playing is never touched by the live loop.
  function release(phone) {
    var running = phone.querySelector("iframe");
    window.clearInterval(phone._timer);
    phone._claimed = false;
    if (!running) return;
    frames = frames.filter(function (frame) { return frame !== running; });
    running.remove();
    var screen = phone.querySelector(".phone-screen");
    screen.classList.remove("veil");
    if (phone._cover) screen.appendChild(phone._cover);
  }

  function unmountOthers(keep) {
    document.querySelectorAll(".phone").forEach(function (other) {
      if (other !== keep) release(other);
    });
  }

  // The games lay their text out for a phone about 390 px wide. In a smaller frame the iframe keeps
  // that width and is scaled down, so a small phone shows the real layout instead of a squeezed one.
  var REF_WIDTH = 390;
  function fit(screen, frame) {
    var width = screen.clientWidth;
    if (!width) return;
    var scale = width / REF_WIDTH;
    frame.style.width = REF_WIDTH + "px";
    frame.style.height = screen.clientHeight / scale + "px";
    frame.style.transformOrigin = "0 0";
    frame.style.transform = "scale(" + scale + ")";
  }

  function mount(phone, attract) {
    var screen = phone.querySelector(".phone-screen");
    if (!screen || screen.querySelector("iframe")) return screen && screen.querySelector("iframe");
    // A live (attract) phone runs next to its neighbours. A phone started by the visitor runs alone.
    if (!attract) unmountOthers(phone);
    var frame = document.createElement("iframe");
    frame.src = phone.getAttribute("data-src");
    frame.title = phone.getAttribute("data-title") || "Playable ad";
    frame.setAttribute("allow", "autoplay; fullscreen; vibrate");
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox");
    screen.appendChild(frame);
    fit(screen, frame);
    if (window.ResizeObserver) new ResizeObserver(function () { fit(screen, frame); }).observe(screen);
    frames.push(frame);
    var cover = phone.querySelector(".phone-play");
    if (cover) {
      phone._cover = cover;
      cover.remove();
    }
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

  // Live phones (the home hero): the center featured phone runs by itself while the hero is on
  // screen, and side phones run on hover or focus, so the hero stays smooth on modest GPUs.
  // Live phones restart every few seconds behind a poster veil, so an end card never shows.
  // The first input inside any phone claims it: the others stop and the visitor plays alone.
  var livePhones = Array.prototype.slice.call(document.querySelectorAll(".phone[data-live]"));
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var heroVisible = false;

  function isSidePhone(phone) {
    return phone.classList.contains("phone-side");
  }

  function hasClaimedLive() {
    return livePhones.some(function (phone) { return Boolean(phone._claimed); });
  }

  function startLive(phone, index) {
    // Hidden side phones (phone widths), claimed phones, or when another phone is claimed are skipped.
    if (phone._claimed || hasClaimedLive() || phone.offsetParent === null || phone.querySelector("iframe")) return;
    mount(phone, true);
    var screen = phone.querySelector(".phone-screen");
    var loop = (Number(phone.getAttribute("data-loop")) || 11000) + index * 1300;
    phone._timer = window.setInterval(function () {
      var frame = phone.querySelector("iframe");
      if (!frame || phone._claimed) return;
      screen.classList.add("veil");
      window.setTimeout(function () { frame.src = phone.getAttribute("data-src"); }, 180);
      window.setTimeout(function () { screen.classList.remove("veil"); }, 1100);
    }, loop);
  }

  function stopLive(phone) {
    if (!phone._claimed) release(phone);
  }

  function syncHeroLive() {
    var active = heroVisible && !document.hidden;
    livePhones.forEach(function (phone, index) {
      if (!active) {
        stopLive(phone);
      } else if (!isSidePhone(phone)) {
        startLive(phone, index);
      }
    });
  }

  if (livePhones.length && !reduceMotion && "IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      heroVisible = entries.some(function (entry) { return entry.isIntersecting; });
      syncHeroLive();
    }, { threshold: 0.25 }).observe(livePhones[0].parentElement);

    document.addEventListener("visibilitychange", syncHeroLive);

    livePhones.forEach(function (phone, index) {
      if (!isSidePhone(phone)) return;
      var wake = function () { if (heroVisible && !document.hidden) startLive(phone, index); };
      var sleep = function () { stopLive(phone); };
      phone.addEventListener("mouseenter", wake);
      phone.addEventListener("focusin", wake);
      phone.addEventListener("mouseleave", sleep);
      phone.addEventListener("focusout", function (event) {
        if (!phone.contains(event.relatedTarget)) sleep();
      });
    });
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.source !== "playable" || typeof data.name !== "string" || data.name.indexOf("first_") !== 0) return;
    var owner = livePhones.filter(function (phone) {
      var frame = phone.querySelector("iframe");
      return frame && frame.contentWindow === event.source;
    })[0];
    if (!owner || owner._claimed) return;
    owner._claimed = true;
    window.clearInterval(owner._timer);
    owner.querySelector(".phone-screen").classList.remove("veil");
    livePhones.forEach(function (other) { if (other !== owner) stopLive(other); });
  });

  // Live telemetry: the playable posts plain messages, the page lists them.
  var log = document.getElementById("telemetry-log");
  if (log) {
    var clear = document.querySelector(".console-clear");
    var count = 0;
    var first = null;
    var statFirst = document.getElementById("stat-first");
    var statEvents = document.getElementById("stat-events");
    var statSpan = document.getElementById("stat-span");
    var sawFirstInput = false;
    var runEvents = 0;

    function resetStats() {
      sawFirstInput = false;
      runEvents = 0;
      if (statFirst) statFirst.textContent = "-";
      if (statEvents) statEvents.textContent = "0";
      if (statSpan) statSpan.textContent = "-";
    }

    if (clear) {
      clear.addEventListener("click", function () {
        log.innerHTML = '<li class="console-empty">Log cleared. Play again to see new events.</li>';
        count = 0;
        first = null;
        resetStats();
      });
    }

    window.addEventListener("message", function (event) {
      var data = event.data;
      var known = frames.some(function (frame) { return frame.contentWindow === event.source; });
      if (!known || !data || data.source !== "playable" || typeof data.name !== "string") return;

      if (count === 0) log.innerHTML = "";
      // A new run (a fresh iframe) starts its own clock, so the numbers restart with its impression.
      if (first === null || data.name === "impression") {
        first = data.t;
        resetStats();
      }
      count += 1;

      // Session numbers: the first event named first_* is the first input, as the ad measures it.
      if (!sawFirstInput && data.name.indexOf("first_") === 0 && statFirst) {
        sawFirstInput = true;
        var ms = data.data && typeof data.data.ms === "number" ? data.data.ms : data.t - first;
        statFirst.textContent = (ms / 1000).toFixed(2) + "s";
      }
      runEvents += 1;
      if (statEvents) statEvents.textContent = String(runEvents);
      if (statSpan) statSpan.textContent = ((data.t - first) / 1000).toFixed(1) + "s";

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
