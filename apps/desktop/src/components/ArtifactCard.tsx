import { useEffect, useState } from "react";
import {
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Presentation,
  File as FileIcon,
  FileCode,
} from "lucide-react";
import type { Artifact } from "@office/contracts";

export function kindFromPath(name: string): Artifact["kind"] {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["xlsx", "xls", "csv"].includes(ext)) return "sheet";
  if (["doc", "docx", "rtf", "odt"].includes(ext)) return "doc";
  if (["ppt", "pptx"].includes(ext)) return "slides";
  if (ext === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (["md", "markdown"].includes(ext)) return "markdown";
  if (["txt", "log"].includes(ext)) return "text";
  if (["ts", "tsx", "js", "py", "json", "html", "css", "sh"].includes(ext)) return "code";
  return "other";
}

const KIND_ICON: Record<string, typeof FileText> = {
  sheet: FileSpreadsheet,
  doc: FileText,
  slides: Presentation,
  pdf: FileText,
  image: ImageIcon,
  markdown: FileText,
  text: FileText,
  code: FileCode,
  other: FileIcon,
};

const KIND_LABEL: Record<Artifact["kind"], string> = {
  sheet: "表格",
  doc: "文档",
  slides: "演示",
  pdf: "PDF",
  image: "图片",
  markdown: "Markdown",
  text: "文本",
  code: "代码",
  other: "文件",
};

export function ArtifactCard({
  artifact,
  onOpen,
  onReveal,
  onStat,
}: {
  artifact: Artifact;
  onOpen: (path: string) => void;
  onReveal: (path: string) => void;
  onStat: (path: string) => Promise<{ sizeKb: number } | null>;
}) {
  const [sizeKb, setSizeKb] = useState(artifact.sizeKb);
  const Icon = KIND_ICON[artifact.kind] ?? FileIcon;

  useEffect(() => {
    if (sizeKb !== undefined) return;
    let alive = true;
    void onStat(artifact.path).then((r) => {
      if (alive && r) setSizeKb(r.sizeKb);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact.path]);

  return (
    <div className="artifact-card">
      <span className={"art-icon art-" + artifact.kind}>
        <Icon size={17} />
      </span>
      <div className="art-info">
        <div className="art-name">
          {artifact.name}
          {artifact.modified && <em className="art-mod">已修改</em>}
        </div>
        <div className="art-meta">
          {KIND_LABEL[artifact.kind]}
          {sizeKb !== undefined ? ` · ${sizeKb} KB` : ""}
        </div>
      </div>
      <div className="art-actions">
        <button onClick={() => onOpen(artifact.path)}>打开</button>
        <button onClick={() => onReveal(artifact.path)}>在文件夹中显示</button>
      </div>
    </div>
  );
}

