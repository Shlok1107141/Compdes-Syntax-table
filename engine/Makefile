CC      ?= gcc
CFLAGS  ?= -std=c11 -Wall -Wextra -O2
SANFLAGS = -std=c11 -Wall -Wextra -Werror -g -fsanitize=address,undefined -fno-omit-frame-pointer

BINARIES = symtab_analyze symtab_demo symtab_stress

all: $(BINARIES)

%: %.c
	$(CC) $< -o $@ $(CFLAGS)

# Testing standard: verify under sanitizers, then measure.
check:
	$(CC) symtab_analyze.c -o symtab_analyze_san $(SANFLAGS)
	$(CC) symtab_demo.c    -o symtab_demo_san    $(SANFLAGS)
	$(CC) symtab_stress.c  -o symtab_stress_san  $(SANFLAGS)
	./symtab_demo_san > /dev/null
	./symtab_stress_san > /dev/null
	printf 'int counter; int counter_max;\n' | ./symtab_analyze_san > /dev/null
	@echo "sanitizer check: clean"

clean:
	rm -f $(BINARIES) symtab_analyze_san symtab_demo_san symtab_stress_san

.PHONY: all check clean
