/**
 * GroupContextMenu.styles.js
 *
 * CSS for the <group-context-menu> Lit component, extracted to keep the
 * component file focused on logic.  Import and assign to `static styles`.
 */
import { css } from '../vendor/lit.js';

export const groupContextMenuStyles = css`
  :host {
    position: fixed;
    z-index: 9000;
    pointer-events: none;
  }
  .menu {
    position: fixed;
    background: #fff;
    border: 1px solid rgba(0,0,0,0.12);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.18);
    padding: 4px 0;
    min-width: 180px;
    pointer-events: auto;
    font-family: inherit;
  }
  .menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    font-size: 0.85rem;
    color: #222;
    cursor: pointer;
    border: none;
    background: none;
    width: 100%;
    text-align: left;
    border-radius: 4px;
  }
  .menu-item:hover { background: #f0f4ff; }
  .menu-item.danger { color: #c0392b; }
  .menu-item.danger:hover { background: #fff0f0; }
  .menu-separator {
    height: 1px;
    background: rgba(0,0,0,0.08);
    margin: 3px 0;
  }
  /* Inline create / update form */
  .create-form {
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .create-form input[type='text'],
  .create-form select {
    width: 100%;
    box-sizing: border-box;
    padding: 5px 8px;
    font-size: 0.85rem;
    border: 1px solid #ccc;
    border-radius: 4px;
  }
  .swatch-row {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .swatch {
    width: 20px;
    height: 20px;
    border-radius: 4px;
    border: 2px solid transparent;
    cursor: pointer;
    box-sizing: border-box;
  }
  .swatch.selected { border-color: #fff; box-shadow: 0 0 0 2px #0078d4; }
  .create-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }
  .btn {
    padding: 4px 10px;
    border-radius: 4px;
    border: 1px solid #ccc;
    cursor: pointer;
    font-size: 0.8rem;
    background: #fff;
  }
  .btn.primary { background: #0078d4; color: #fff; border-color: #0078d4; }
`;
