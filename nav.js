function initTabs() {
  const tabs = document.querySelectorAll(".app-tab");
  const pages = document.querySelectorAll(".app-page");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.page;
      tabs.forEach((t) => {
        t.classList.toggle("active", t === tab);
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      pages.forEach((page) => {
        page.classList.toggle("hidden", page.dataset.page !== target);
      });
    });
  });
}

document.addEventListener("DOMContentLoaded", initTabs);
