(function () {
  var storageKey = "inkforge.theme";
  var storedTheme = window.localStorage.getItem(storageKey);
  var systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  var theme = storedTheme === "dark" || storedTheme === "light" ? storedTheme : systemDark ? "dark" : "light";
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
})();
