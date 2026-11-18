#!/usr/bin/awk -f
# Reads `dexdump -d` output; prints each use of a Window API deprecated for edge to edge and exits 1 if there is any.
# Used by check-window-apis.sh.

# A new method: forget the constants seen so far.
/^ +name +: '/ { method = $0; sub(/^ +name +: /, "", method); delete constOf; next }
/^ +#[0-9]+ +: \(in L/ { owner = $0; sub(/^.*\(in /, "", owner); sub(/\)$/, "", owner); next }

# Instruction lines look like "0012ba: 5901 5678   |0005: iput v1, v0, Lpkg/Cls;.field:I // field@5678".
/[|][0-9a-f]+: [a-z]/ {
  line = $0
  sub(/^[^|]*[|][0-9a-f]+: /, "", line)
  op = line; sub(/ .*/, "", op)
  args = line; sub(/^[^ ]+ /, "", args)
  first = args; sub(/,.*/, "", first)

  if (line ~ /Landroid\/view\/Window;\.(setStatusBarColor|setNavigationBarColor):/) {
    api = line; sub(/^.*Landroid\/view\/Window;\./, "", api); sub(/:.*/, "", api)
    printf "  Window.%s in %s.%s\n", api, owner, method; hit = 1
  }

  if (op ~ /^iput/ && line ~ /Landroid\/view\/WindowManager\$LayoutParams;\.layoutInDisplayCutoutMode:I/) {
    if ((first in constOf) && constOf[first] == 1) {
      printf "  LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES in %s.%s\n", owner, method; hit = 1
    }
  }

  # Track the last constant each register holds; any other instruction that writes vA makes it unknown.
  if (op ~ /^const(\/4|\/16|\/high16)?$/ && args ~ /#int -?[0-9]+/) {
    v = args; sub(/^.*#int /, "", v); sub(/[^-0-9].*$/, "", v); constOf[first] = v + 0
  } else if (op !~ /^(iput|sput|aput|invoke|if-|return|throw|goto|packed-switch|sparse-switch|fill-array-data|monitor|check-cast|filled-new-array|nop)/) {
    delete constOf[first]
  }
}

END { exit hit ? 1 : 0 }
