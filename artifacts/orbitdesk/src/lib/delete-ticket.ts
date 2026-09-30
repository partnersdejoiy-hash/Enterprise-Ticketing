export async function deleteTicket(id: number) {
  const token = localStorage.getItem("auth_token");
  const res = await fetch(`/api/tickets/${id}`, {
    method: "DELETE",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      typeof body.error === "string"
        ? body.error
        : `Ticket deletion failed (${res.status}). Please retry.`,
    );
  }
}
export async function deleteTickets(ids: number[]) {
  const results = await Promise.allSettled(ids.map(deleteTicket));
  return {
    deleted: ids.filter((_, i) => results[i].status === "fulfilled"),
    failed: ids.flatMap((id, i) => {
      const result = results[i];
      return result.status === "rejected"
        ? [
            {
              id,
              error:
                result.reason instanceof Error
                  ? result.reason.message
                  : "Network error",
            },
          ]
        : [];
    }),
  };
}
