(function () {
  const nav = document.getElementById("mainNav");
  const navToggle = nav?.querySelector(".navbar-toggler");
  const navCollapse = document.getElementById("publicNavigation");
  const year = document.getElementById("currentYear");
  const copyItems = document.querySelectorAll("[data-copy]");

  if (navToggle && navCollapse) {
    navToggle.addEventListener("click", () => {
      if (window.bootstrap) return;
      const isExpanded = navToggle.getAttribute("aria-expanded") === "true";
      navToggle.setAttribute("aria-expanded", String(!isExpanded));
      navCollapse.classList.toggle("show", !isExpanded);
    });

    navCollapse.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        if (window.bootstrap) return;
        navCollapse.classList.remove("show");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  if (year) {
    year.textContent = String(new Date().getFullYear());
  }

  function updateNavbar() {
    if (nav) {
      nav.classList.toggle("scrolled", window.scrollY > 20);
    }
  }

  updateNavbar();
  window.addEventListener("scroll", updateNavbar, { passive: true });

  copyItems.forEach((item) => {
    item.addEventListener("click", async () => {
      const value = item.getAttribute("data-copy");
      try {
        await navigator.clipboard.writeText(value);
        const element = document.getElementById("copyToast");
        if (element && window.bootstrap) {
          window.bootstrap.Toast.getOrCreateInstance(element).show();
        }
      } catch (_error) {
        const range = document.createRange();
        range.selectNodeContents(item);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
    });
  });

  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", () => {
      const collapse = document.querySelector(".navbar-collapse.show");
      if (collapse && window.bootstrap) {
        window.bootstrap.Collapse.getInstance(collapse)?.hide();
      }
    });
  });
})();
