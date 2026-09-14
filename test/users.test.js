import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addUser,
  createDefaultUsers,
  deleteUsers,
  editUser,
  normalizeUser,
  selectUserRows,
  sortUsers,
  USER_TYPES,
} from "../users.js";

const login = new Date(2026, 8, 14, 9, 30);

function regularUser(id = "user-1", overrides = {}) {
  return {
    id,
    username: `person-${id}`,
    password: "secret",
    firstName: "First",
    lastName: "Last",
    userType: "User",
    lastLogin: null,
    ...overrides,
  };
}

test("creates the required default administrator and supports both user types", () => {
  const [administrator] = createDefaultUsers(login);
  assert.deepEqual(USER_TYPES, ["Administrator", "User"]);
  assert.equal(administrator.username, "Admin");
  assert.equal(administrator.password, "Watchdog");
  assert.equal(administrator.userType, "Administrator");
  assert.equal(administrator.lastLogin.getTime(), login.getTime());
});

test("requires every new-user field and a valid user type", () => {
  assert.throws(() => normalizeUser(regularUser("missing", { firstName: "" })), /required/i);
  assert.throws(() => normalizeUser(regularUser("type", { userType: "Owner" })), /Administrator or User/i);
});

test("adds users, enforces unique usernames, and edits every supported field", () => {
  let users = createDefaultUsers(login);
  users = addUser(users, regularUser());
  assert.throws(() => addUser(users, regularUser("user-2", { username: "PERSON-USER-1" })), /unique/i);

  users = editUser(users, "user-1", {
    username: "updated",
    password: "new-password",
    firstName: "Updated",
    lastName: "Person",
    userType: "Administrator",
  });
  assert.deepEqual(
    (({ username, password, firstName, lastName, userType }) => ({ username, password, firstName, lastName, userType }))(users[1]),
    { username: "updated", password: "new-password", firstName: "Updated", lastName: "Person", userType: "Administrator" },
  );
});

test("always retains at least one administrator during edits and deletes", () => {
  const users = [...createDefaultUsers(login), regularUser()];
  assert.throws(
    () => editUser(users, "default-admin", { ...users[0], userType: "User" }),
    { message: "At least one administrator account is required" },
  );
  assert.throws(
    () => deleteUsers(users, new Set(["default-admin"])),
    { message: "At least one administrator account is required" },
  );

  const withSecondAdministrator = addUser(users, regularUser("admin-2", { username: "SecondAdmin", userType: "Administrator" }));
  const remaining = deleteUsers(withSecondAdministrator, new Set(["default-admin", "user-1"]));
  assert.deepEqual(remaining.map((user) => user.id), ["admin-2"]);
});

test("selects one row normally and toggles rows with Ctrl", () => {
  assert.deepEqual([...selectUserRows(new Set(["a", "b"]), "c", false)], ["c"]);
  assert.deepEqual([...selectUserRows(new Set(["a"]), "b", true)], ["a", "b"]);
  assert.deepEqual([...selectUserRows(new Set(["a", "b"]), "a", true)], ["b"]);
});

test("sorts every displayed user field in ascending or descending order", () => {
  const users = [
    regularUser("b", { username: "Zulu", firstName: "Zed", lastName: "Able", userType: "User", lastLogin: new Date(2026, 0, 2) }),
    regularUser("a", { username: "Alpha", firstName: "Amy", lastName: "Zulu", userType: "Administrator", lastLogin: new Date(2026, 0, 1) }),
  ];
  for (const field of ["username", "firstName", "lastName", "userType", "lastLogin"]) {
    const ascending = sortUsers(users, field, "asc").map((user) => user.id);
    const descending = sortUsers(users, field, "desc").map((user) => user.id);
    assert.deepEqual(descending, ascending.toReversed());
  }
});

test("places administrator-only user management controls on the main screen", () => {
  const markup = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const application = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(markup, /id="open-user-management"[^>]*>User Management</);
  assert.match(markup, /id="user-management-dialog"/);
  for (const label of ["Username", "First Name", "Last Name", "User Type", "Last login"]) {
    assert.match(markup, new RegExp(`>${label}<`));
  }
  assert.match(markup, /id="add-user"/);
  assert.match(markup, /id="edit-user"/);
  assert.match(markup, /id="delete-users"/);
  assert.match(markup, /id="add-user-confirm-dialog"/);
  assert.match(markup, /This deletion is permanent/);
  assert.match(markup, /Acknowledge and delete/);
  assert.match(application, /deleteUsers\(users, selectedUserIds\);[\s\S]*return;[\s\S]*deleteUsersConfirmDialog\.showModal\(\)/);
});
