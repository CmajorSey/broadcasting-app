/* ===========================
   🔐 Shared Permission Utility
   =========================== */

/**
 * Lo Board permission helpers
 * - Uses roles[] only for global admin
 * - Uses description string for section identity (producer/journalist/sports journalist)
 */

const norm = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");

const hasRole = (user, role) => (user?.roles || []).includes(role);

const descIncludes = (user, token) => {
  const d = norm(user?.description);
  return !!token && d.includes(norm(token));
};

/* ===========================
   🛡 Global admin
   =========================== */
export const isAdminUser = (user) => hasRole(user, "admin");

/* ===========================
   🎬 Production
   =========================== */
export const isProductionEditor = (user) => descIncludes(user, "producer");

export const canEditProduction = (user) => isAdminUser(user) || isProductionEditor(user);

// Production: non-editors see ONLY airing + filming (no notes)
export const canViewProductionInternalNotes = (user) => canEditProduction(user);

/* ===========================
   📰 Newsroom
   =========================== */
export const isNewsroomEditor = (user) => {
  /**
   * ✅ IMPORTANT RULE:
   * - Sports Journalists can VIEW Newsroom, but must NOT be able to WRITE there.
   * - Because "sports journalist" contains the word "journalist", we must explicitly block it.
   */
  if (descIncludes(user, "sports journalist")) return false;

  return (
    descIncludes(user, "journalist") ||
    descIncludes(user, "chief editor") ||
    descIncludes(user, "senior journalist")
  );
};

export const canEditNewsroom = (user) => isAdminUser(user) || isNewsroomEditor(user);

/* ===========================
   ⚽ Sports
   =========================== */
export const isSportsEditor = (user) => descIncludes(user, "sports journalist");

export const canEditSports = (user) => isAdminUser(user) || isSportsEditor(user);

/* ===========================
   🧩 Generic resolver
   =========================== */
export const getSectionPermissions = (section, user) => {
  const s = norm(section);

  if (s === "production") {
    const canEdit = canEditProduction(user);
    return { canEdit, canSeeNotes: canViewProductionInternalNotes(user) };
  }

  if (s === "newsroom") {
    const canEdit = canEditNewsroom(user);
    return { canEdit, canSeeNotes: canEdit };
  }

  if (s === "sports") {
    const canEdit = canEditSports(user);
    return { canEdit, canSeeNotes: canEdit };
  }

  return { canEdit: false, canSeeNotes: false };
};
