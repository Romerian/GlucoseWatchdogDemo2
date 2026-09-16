export const USER_TYPES = Object.freeze(["Administrator", "User"]);

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeUserType(value) {
  const match = USER_TYPES.find((type) => type.toLowerCase() === cleanText(value).toLowerCase());
  if (!match) throw new Error("Select a user type: Administrator or User.");
  return match;
}

export function createDefaultUsers(lastLogin = new Date()) {
  return [{
    id: "default-admin",
    username: "Admin",
    password: "Watchdog",
    firstName: "Default",
    lastName: "Administrator",
    userType: "Administrator",
    lastLogin: new Date(lastLogin),
  }];
}

export function normalizeUser(user) {
  const normalized = {
    id: cleanText(user.id),
    username: cleanText(user.username),
    password: String(user.password ?? ""),
    firstName: cleanText(user.firstName),
    lastName: cleanText(user.lastName),
    userType: normalizeUserType(user.userType),
    lastLogin: user.lastLogin ? new Date(user.lastLogin) : null,
  };

  if (!normalized.username || !normalized.password || !normalized.firstName || !normalized.lastName) {
    throw new Error("Username, password, first name, last name, and user type are required.");
  }
  if (normalized.lastLogin && Number.isNaN(normalized.lastLogin.getTime())) {
    throw new Error("Last login must be a valid date and time.");
  }
  return normalized;
}

function ensureUniqueUsername(users, username, excludedId = null) {
  const duplicate = users.some((user) => user.id !== excludedId && user.username.toLowerCase() === username.toLowerCase());
  if (duplicate) throw new Error("Username must be unique.");
}

export function addUser(users, user) {
  const normalized = normalizeUser(user);
  ensureUniqueUsername(users, normalized.username);
  return [...users, normalized];
}

export function editUser(users, userId, changes) {
  const current = users.find((user) => user.id === userId);
  if (!current) throw new Error("Select one user to edit.");
  const updated = normalizeUser({ ...current, ...changes, id: current.id, lastLogin: current.lastLogin });
  ensureUniqueUsername(users, updated.username, current.id);

  const administratorCount = users.filter((user) => user.userType === "Administrator").length;
  if (current.userType === "Administrator" && updated.userType !== "Administrator" && administratorCount === 1) {
    throw new Error("At least one administrator account is required");
  }
  return users.map((user) => user.id === userId ? updated : user);
}

export function deleteUsers(users, userIds) {
  const selected = new Set(userIds);
  const remaining = users.filter((user) => !selected.has(user.id));
  if (remaining.filter((user) => user.userType === "Administrator").length === 0) {
    throw new Error("At least one administrator account is required");
  }
  return remaining;
}

export function selectUserRows(selectedIds, clickedId, ctrlKey) {
  if (!ctrlKey) return new Set([clickedId]);
  const updated = new Set(selectedIds);
  if (updated.has(clickedId)) updated.delete(clickedId);
  else updated.add(clickedId);
  return updated;
}

export function sortUsers(users, field, direction = "asc") {
  const factor = direction === "desc" ? -1 : 1;
  return [...users].sort((left, right) => {
    if (field === "lastLogin") {
      return ((left.lastLogin?.getTime() ?? 0) - (right.lastLogin?.getTime() ?? 0)) * factor;
    }
    return String(left[field] ?? "").localeCompare(String(right[field] ?? ""), undefined, { numeric: true, sensitivity: "base" }) * factor;
  });
}
