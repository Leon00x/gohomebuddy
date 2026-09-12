/** 应用内删除确认：替代系统 confirm（UI 规范 22.5），Danger 主按钮。 */
export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  action: () => void;
}

export function ConfirmDialog({
  request,
  onCancel,
}: {
  request: ConfirmRequest | null;
  onCancel: () => void;
}) {
  if (!request) return null;
  return (
    <>
      <div className="menu-overlay" onClick={onCancel} />
      <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-label={request.title}>
        <div className="confirm-title">{request.title}</div>
        <p className="confirm-body">{request.body}</p>
        <div className="confirm-actions">
          <button className="confirm-cancel" onClick={onCancel}>
            取消
          </button>
          <button
            className="confirm-danger"
            onClick={() => {
              request.action();
              onCancel();
            }}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
