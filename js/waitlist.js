document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("waitlistModal");
  const openButton = document.getElementById("openWaitlist");
  const closeButton = document.getElementById("closeWaitlist");
  const form = document.getElementById("waitlistForm");
  const emailInput = document.getElementById("waitlistEmail");
  const honeypot = document.getElementById("waitlistWebsite");
  const submitButton = document.getElementById("waitlistSubmit");
  const message = document.getElementById("waitlistMessage");

  if (!modal || !openButton || !closeButton || !form || !emailInput || !submitButton) return;

  const STORAGE_KEY = "gih_waitlist_email";
  const BUTTON_LABEL = "Submit";
  let isSubmitting = false;

  function getSavedEmail() {
    try { return localStorage.getItem(STORAGE_KEY) || ""; } catch { return ""; }
  }

  function saveEmail(email) {
    try { localStorage.setItem(STORAGE_KEY, email); } catch { /* storage blocked, ignore */ }
  }

  function setMessage(text, type) {
    message.textContent = text;
    message.className = type ? "is-" + type : "";
  }

  function setButton(label, disabled) {
    submitButton.textContent = label;
    submitButton.disabled = disabled;
  }

  // Lock the button when the typed email was already submitted from this browser.
  function syncState() {
    if (isSubmitting) return;
    const saved = getSavedEmail();
    const current = emailInput.value.trim().toLowerCase();
    if (saved && current === saved) {
      setButton("Submitted", true);
      setMessage("You're already on the waitlist with this email.", "success");
    } else {
      setButton(BUTTON_LABEL, false);
      if (message.className === "is-success") setMessage("", "");
    }
  }

  function openModal() {
    modal.hidden = false;
    const saved = getSavedEmail();
    if (saved && !emailInput.value) emailInput.value = saved;
    syncState();
    emailInput.focus();
  }

  function closeModal() {
    if (isSubmitting) return; // keep it open until the request finishes
    modal.hidden = true;
    setMessage("", "");
  }

  openButton.addEventListener("click", openModal);
  closeButton.addEventListener("click", closeModal);
  emailInput.addEventListener("input", syncState);

  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) closeModal();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    // Ignore extra clicks / Enter presses while a request is running.
    if (isSubmitting) return;

    const email = emailInput.value.trim().toLowerCase();

    if (!emailInput.checkValidity() || !email) {
      emailInput.reportValidity();
      return;
    }

    // Same email already submitted from this browser: don't send again.
    if (email === getSavedEmail()) {
      syncState();
      return;
    }

    isSubmitting = true;
    setButton("Submitting...", true);
    setMessage("", "");

    try {
      const response = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          form_name: "Reliability Waitlist",
          website: honeypot ? honeypot.value : ""
        })
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        const err = new Error(result.error || "Submission failed");
        err.status = response.status;
        throw err;
      }

      saveEmail(email);
      isSubmitting = false;
      setButton("Submitted", true);
      setMessage("Thank you! You're on the waitlist. We'll email you when registration opens.", "success");
    } catch (error) {
      console.error("Waitlist submission error:", error);
      isSubmitting = false;
      setButton(BUTTON_LABEL, false);
      if (error.status === 400) {
        setMessage("Please enter a valid email address.", "error");
      } else if (error.status === 429) {
        setMessage("Too many attempts. Please wait a few minutes and try again.", "error");
      } else {
        setMessage("Sorry, we couldn't submit your email. Please try again.", "error");
      }
    }
  });
});
