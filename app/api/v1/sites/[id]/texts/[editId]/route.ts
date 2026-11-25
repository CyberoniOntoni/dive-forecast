import { apiError, apiHandler, apiSiteTextsResult } from "@/lib/api-v1";
import { reviewWriteSite } from "@/lib/api-review-route";
import { currentSession } from "@/lib/auth";
import { readStore } from "@/lib/store";
import { withdrawSiteEdit } from "@/lib/wiki-actions";

/** Withdraws the diver's own edit while it waits for review. Answers with the form, as GET …/texts does. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string; editId: string }> }) {
  return apiHandler(async () => {
    const { id, editId } = await context.params;
    const siteId = await reviewWriteSite(request, id);
    if (siteId instanceof Response) return siteId;
    const session = await currentSession();
    if (!session) return apiError(401, "unauthorized", "Sign in again.");
    // Only the diver's own edit on this site, still waiting: another diver's, one on another site, or one already
    // looked at is not there to withdraw.
    const edit = readStore().siteEdits.find((item) => item.id === editId);
    if (!edit || edit.siteId !== siteId || edit.userId !== session.userId || edit.status !== "pending") {
      return apiError(404, "not_found", "That edit is not waiting for review.");
    }
    return apiSiteTextsResult(await withdrawSiteEdit(editId));
  });
}
