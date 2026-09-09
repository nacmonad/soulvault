import { redirect } from "next/navigation";

export default function DocumentsIndexPage() {
  redirect("/dashboard/documents/redact");
}
