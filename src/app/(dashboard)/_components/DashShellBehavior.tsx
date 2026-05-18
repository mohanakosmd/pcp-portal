"use client";

import { useEffect } from "react";

const STORAGE_KEY = "pcp-dash-sidebar-collapsed";

export function DashShellBehavior() {
  useEffect(() => {
    const menuBtn = document.getElementById("dash-menu-btn");
    const sidebar = document.getElementById("dash-sidebar");
    const backdrop = document.getElementById("dash-backdrop");
    const layout = document.getElementById("dash-layout");
    const collapseToggle = document.getElementById("dash-sidebar-toggle");

    if (!sidebar || !backdrop || !layout || !collapseToggle) return;

    const isDesktop = () => window.innerWidth > 900;

    const closeMenu = () => {
      sidebar.classList.remove("is-open");
      backdrop.classList.remove("is-open");
      backdrop.setAttribute("aria-hidden", "true");
      menuBtn?.setAttribute("aria-expanded", "false");
    };

    const openMenu = () => {
      sidebar.classList.add("is-open");
      backdrop.classList.add("is-open");
      backdrop.setAttribute("aria-hidden", "false");
      menuBtn?.setAttribute("aria-expanded", "true");
    };

    const toggleMenu = () => {
      if (sidebar.classList.contains("is-open")) closeMenu();
      else openMenu();
    };

    const setNavTooltips = (collapsed: boolean) => {
      sidebar.querySelectorAll<HTMLElement>("a[data-nav-label]").forEach((link) => {
        link.title = collapsed && isDesktop() ? link.getAttribute("data-nav-label") || "" : "";
      });
    };

    const applySidebarState = () => {
      if (!isDesktop()) {
        layout.classList.remove("dash-layout--sidebar-collapsed");
        setNavTooltips(false);
        collapseToggle.setAttribute("aria-expanded", "true");
        collapseToggle.setAttribute("aria-label", "Collapse side navigation");
        return;
      }
      const collapsed = localStorage.getItem(STORAGE_KEY) === "1";
      layout.classList.toggle("dash-layout--sidebar-collapsed", collapsed);
      collapseToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      collapseToggle.setAttribute(
        "aria-label",
        collapsed ? "Expand side navigation" : "Collapse side navigation"
      );
      setNavTooltips(collapsed);
    };

    const handleToggleClick = () => {
      if (!isDesktop()) return;
      const toCollapsed = !layout.classList.contains("dash-layout--sidebar-collapsed");
      layout.classList.toggle("dash-layout--sidebar-collapsed", toCollapsed);
      localStorage.setItem(STORAGE_KEY, toCollapsed ? "1" : "0");
      collapseToggle.setAttribute("aria-expanded", toCollapsed ? "false" : "true");
      collapseToggle.setAttribute(
        "aria-label",
        toCollapsed ? "Expand side navigation" : "Collapse side navigation"
      );
      setNavTooltips(toCollapsed);
    };

    const handleResize = () => {
      if (window.innerWidth > 900) closeMenu();
      applySidebarState();
    };

    menuBtn?.addEventListener("click", toggleMenu);
    backdrop.addEventListener("click", closeMenu);
    collapseToggle.addEventListener("click", handleToggleClick);
    window.addEventListener("resize", handleResize, { passive: true });

    applySidebarState();

    return () => {
      menuBtn?.removeEventListener("click", toggleMenu);
      backdrop.removeEventListener("click", closeMenu);
      collapseToggle.removeEventListener("click", handleToggleClick);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return null;
}
