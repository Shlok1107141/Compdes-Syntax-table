CC ?= gcc
CFLAGS = -std=c11 -O2 -Wall -Wextra -Werror -pedantic
SANFLAGS = -std=c11 -g -Wall -Wextra -Werror -pedantic -fsanitize=address,undefined -fno-omit-frame-pointer

ALL = variant_a_bitpack variant_b_arena variant_c_trie \
      variant_ab_arena_bitpack variant_ac_trie_bitpack variant_bc_trie_arena \
      variant_abc_full

all: $(ALL) symtab_analyze

variant_%: variant_%.c symtab_common.h
	$(CC) $(CFLAGS) -o $@ $<

symtab_analyze: symtab_analyze.c
	$(CC) $(CFLAGS) -o $@ $<

run: all
	@for v in $(ALL); do ./$$v; done

sweep:
	./run_sweep.sh

# Testing standard: verify under sanitizers, then measure.
check:
	$(CC) $(SANFLAGS) -o symtab_analyze_san symtab_analyze.c
	printf 'int counter; int counter_max;\n' | ./symtab_analyze_san > /dev/null
	@echo "sanitizer check: clean"

clean:
	rm -f $(ALL) symtab_analyze symtab_analyze_san

.PHONY: all run sweep check clean
