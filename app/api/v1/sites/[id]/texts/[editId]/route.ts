import { apiError, apiHandler, apiSiteTextsResult } from "@/lib/api-v1";
import { reviewWriteSite } from "@/lib/api-review-route";
import { readStore } from "@/lib/store";
import { withdrawSiteEdit } from "@/lib/wiki-actions";

/** Withdraws the diver's own edit while it waits for review. Answers with the form, as GET …/texts does. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string; editId: string }> }) {
  return apiHandler(async () => {
    const { id, editId } = await context.params;
    const siteId = await reviewWriteSite(request, id);
    if (siteId instanceof Response) return siteId;
    // An edit on another site is not this one's: the same answer as an unknown edit.
    if (readStore().siteEdits.find((edit) => edit.id === editId)?.siteId !== siteId) return apiError(404, "not_found", "Unknown edit.");
    return apiSiteTextsResult(await withdrawSiteEdit(editId));
  });
}
