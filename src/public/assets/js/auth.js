(function () {
  let csrfToken = "";

  async function getCsrfToken() {
    const response = await fetch("/api/csrf-token", { credentials: "same-origin" });
    if (!response.ok) {
      throw new Error("Registration service is unavailable. Start the Node.js app and open http://localhost:3000.");
    }
    const data = await response.json();
    csrfToken = data.csrfToken;
  }

  function setLoading(form, isLoading) {
    const button = form.querySelector("[type='submit']");
    button.disabled = isLoading;
    button.innerHTML = isLoading
      ? '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Please wait'
      : button.dataset.label;
  }

  function showAlert(form, message, type) {
    let alert = form.querySelector(".form-alert");
    if (!alert) {
      alert = document.createElement("div");
      alert.className = "form-alert alert";
      form.prepend(alert);
    }
    alert.className = `form-alert alert alert-${type}`;
    alert.textContent = message;
  }

  function clearValidation(form) {
    form.querySelectorAll(".is-invalid").forEach((field) => field.classList.remove("is-invalid"));
  }

  function applyValidation(form, details) {
    clearValidation(form);
    Object.entries(details || {}).forEach(([fieldName, detail]) => {
      const field = form.elements[fieldName];
      if (!field) return;
      field.classList.add("is-invalid");
      const feedback = field.parentElement.querySelector(".invalid-feedback");
      if (feedback) feedback.textContent = detail.msg;
    });
  }

  document.querySelectorAll(".password-strength-input").forEach((input) => {
    input.addEventListener("input", () => {
      const value = input.value;
      let score = 0;
      if (value.length >= 4) score++;
      if (/[A-Z]/.test(value)) score++;
      if (/[a-z]/.test(value)) score++;
      if (/[0-9]/.test(value)) score++;
      if (/[^A-Za-z0-9]/.test(value)) score++;
      const bar = input.closest(".mb-3")?.querySelector(".password-strength span");
      if (!bar) return;
      const widths = ["0%", "20%", "40%", "60%", "80%", "100%"];
      const colors = ["#c94d4d", "#c94d4d", "#d79a3b", "#d79a3b", "#3c8b63", "#2aa66f"];
      bar.style.width = widths[score];
      bar.style.background = colors[score];
    });
  });

  document.querySelectorAll("[data-auth-form]").forEach((form) => {
    const button = form.querySelector("[type='submit']");
    if (button) button.dataset.label = button.innerHTML;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearValidation(form);
      setLoading(form, true);

      try {
        await getCsrfToken();
        const payload = Object.fromEntries(new FormData(form).entries());
        payload.csrfToken = csrfToken;
        const response = await fetch(form.dataset.authForm, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
          body: JSON.stringify(payload),
        });
        const data = await response.json();

        if (!response.ok) {
          applyValidation(form, data.error?.details);
          const message = data.error?.message || "Request could not be completed.";
          const requestId = data.error?.requestId;
          showAlert(
            form,
            response.status >= 500 && requestId
              ? `${message} Reference: ${requestId}. Please contact support.`
              : message,
            "danger"
          );
          return;
        }

        showAlert(form, data.message, "success");
        if (data.redirect) {
          window.setTimeout(() => { window.location.assign(data.redirect); }, 600);
        }
      } catch (error) {
        showAlert(form, error.message || "A network error occurred.", "danger");
      } finally {
        setLoading(form, false);
      }
    });
  });
})();
