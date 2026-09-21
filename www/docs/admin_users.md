# Admin - Users

The Users screen manages every account that can sign in to the main application, and which of them have admin permission to reach the Admin UI itself.

## Layout

Two lists side by side:

- Regular Users: everyday accounts without admin permission.
- Administrators: accounts with admin permission, able to access every Admin UI screen.

Each list shows a running count as a badge.

## Managing accounts

- Add a new regular user or a new admin directly by entering an email address and clicking the matching Add button.
- Promote a regular user to admin with "Make Admin".
- Remove an account with the Remove button; you cannot remove the account you are currently signed in with.
- Your own account is marked with a "You" badge so it is easy to identify in the list.

## Notes

- Email addresses are validated on entry.
- There is currently only one permission level beyond a plain account: `admin`. There is no finer-grained per-screen permission — any admin account can use every Admin UI screen described in this manual.
- Status messages confirm success or report an error after each change, and clear automatically after a few seconds.
