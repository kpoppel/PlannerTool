/**
 * Shared CSS fragments for the DataSources admin panel and its sub-modules.
 * Import into DataSources.lit.js to compose the component's static styles.
 */
import { css } from '/static/js/vendor/lit.js';

export const backendSelectStyles = css`
  .backend-select-wrap {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  select.backend-select {
    padding: 7px 10px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 0.9rem;
    background: #fff;
    max-width: 320px;
    cursor: pointer;
  }
  select.backend-select:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }
`;

export const subFormStyles = css`
  .sub-form {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 14px 16px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    max-width: 680px;
  }
  .sub-form .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .sub-form .field.full {
    grid-column: 1 / -1;
  }
  .sub-form label {
    font-size: 0.85rem;
    font-weight: 600;
    color: #374151;
  }
  .sub-form .desc {
    font-size: 0.8rem;
    color: #6b7280;
  }
  .sub-form input[type='text'],
  .sub-form input[type='number'],
  .sub-form select {
    padding: 7px 10px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 0.9rem;
    font-family: inherit;
    background: #fff;
  }
  .sub-form input[type='text']:focus,
  .sub-form input[type='number']:focus,
  .sub-form select:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }
  .sub-form input.error,
  .sub-form select.error { border-color: #ef4444; }

  /* toggle (checkbox + label) inside sub-form */
  .sub-form .toggle-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .sub-form .toggle-row input[type='checkbox'] {
    margin-top: 3px;
    flex-shrink: 0;
  }
  .sub-form .toggle-label {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .sub-form .toggle-label span {
    font-size: 0.85rem;
    font-weight: 600;
    color: #374151;
  }
  .sub-form .toggle-label .desc {
    font-size: 0.8rem;
    color: #6b7280;
  }

  /* ado_wiki page combo-box */
  .page-combo {
    position: relative;
  }
  .page-combo input {
    width: 100%;
    box-sizing: border-box;
  }
  .page-suggestions {
    position: absolute;
    z-index: 100;
    top: 100%;
    left: 0;
    right: 0;
    max-height: 200px;
    overflow-y: auto;
    background: #fff;
    border: 1px solid #d1d5db;
    border-top: none;
    border-radius: 0 0 6px 6px;
    box-shadow: 0 4px 8px rgba(0,0,0,0.1);
  }
  .page-suggestion-item {
    padding: 7px 10px;
    font-size: 0.88rem;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .page-suggestion-item:hover {
    background: #eff6ff;
    color: #1d4ed8;
  }
`;

export const ttlStyles = css`
  .ttl-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ttl-wrap input[type='number'] {
    width: 72px;
    padding: 5px 8px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 0.88rem;
    font-family: inherit;
    background: #fff;
  }
  .ttl-wrap input[type='number']:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }
  .ttl-wrap input.error { border-color: #ef4444; }
  .ttl-unit {
    font-size: 0.82rem;
    color: #6b7280;
    flex-shrink: 0;
  }
  .ttl-dash {
    font-size: 0.82rem;
    color: #d1d5db;
  }
  .ttl-stack {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .ttl-stack-label {
    font-size: 0.78rem;
    color: #6b7280;
    margin-bottom: 2px;
  }
`;

export const domainRowStyles = css`
  .domain-name {
    font-weight: 600;
    color: #1f2937;
  }
  .domain-desc {
    font-size: 0.82rem;
    color: #6b7280;
    margin-top: 2px;
  }
  .domain-sub {
    font-size: 0.82rem;
    color: #9ca3af;
    margin-top: 2px;
  }
  .locked-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    background: #f3f4f6;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    font-size: 0.8rem;
    color: #6b7280;
  }
  .error-msg {
    font-size: 0.8rem;
    color: #ef4444;
    margin-top: 2px;
  }
`;
