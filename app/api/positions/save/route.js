import { NextResponse } from "next/server"
import fs   from "fs"
import path from "path"

const FILE = path.join(process.cwd(), ".positions_data.json")

export async function POST(request) {
  const { positions } = await request.json()
  try {
    fs.writeFileSync(FILE, JSON.stringify(positions || []), "utf8")
    return NextResponse.json({ saved: true, count: (positions || []).length })
  } catch (e) {
    return NextResponse.json({ saved: false, error: e.message }, { status: 500 })
  }
}

export async function GET() {
  try {
    const data = fs.readFileSync(FILE, "utf8")
    return NextResponse.json({ positions: JSON.parse(data) })
  } catch {
    return NextResponse.json({ positions: [] })
  }
}
