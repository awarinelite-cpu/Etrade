// Landing page has no required JS for its core content — the hero animation
// and ticker are pure CSS. This file is a hook for small progressive
// enhancements only.

// Re-trigger the hero "trigger bubble" animation each time it scrolls
// into view, so it doesn't just play once on load and then sit static.
document.addEventListener("DOMContentLoaded", () => {
  const bubble = document.getElementById("trigger-bubble");
  if (!bubble || !("IntersectionObserver" in window)) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          bubble.style.animation = "none";
          // Force reflow so the animation can restart
          void bubble.offsetWidth;
          bubble.style.animation = "";
        }
      });
    },
    { threshold: 0.6 }
  );

  observer.observe(bubble);
});
