interface EditorFeedbackProps {
  busy: boolean;
  dirty: boolean;
  error: string;
  saved: boolean;
}

export const EditorFeedback = ({ busy, dirty, error, saved }: EditorFeedbackProps) => (
  <div className="editor-feedback">
    {error ? (
      <p className="error-banner" role="alert">
        {error}
      </p>
    ) : null}
    <span role="status" aria-live="polite">
      {busy ? "正在保存…" : dirty ? "有未保存的修改 · Ctrl+S 保存当前表单" : saved ? "已保存" : ""}
    </span>
  </div>
);
