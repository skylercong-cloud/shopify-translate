import { NextResponse } from "next/server";

import { db } from "@/db/client";
import { createNavigationRepository } from "@/db/repositories/navigation-repository";
import { getCurrentUser } from "@/modules/auth/current-user";
import {
  buildNavigationChildren,
  parseNavigationParent,
} from "@/modules/reader/navigation";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parent = parseNavigationParent(
    new URL(request.url).searchParams.get("parent"),
  );
  if (!parent) {
    return NextResponse.json(
      { error: "invalid_navigation_parent" },
      { status: 400 },
    );
  }

  const entries = await createNavigationRepository(db).listEntriesBelow(
    parent,
  );
  return NextResponse.json({
    parent,
    nodes: buildNavigationChildren(entries, parent),
  });
}
