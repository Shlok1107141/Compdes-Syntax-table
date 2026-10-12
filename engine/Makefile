CC ?= gcc
CFLAGS = -std=c11 -O2 -Wall -Wextra -Werror -pedantic
ALL = variant_a_bitpack variant_b_arena variant_c_trie \
      variant_ab_arena_bitpack variant_ac_trie_bitpack variant_bc_trie_arena \
      variant_abc_full
all: $(ALL)
variant_%: variant_%.c symtab_common.h
	$(CC) $(CFLAGS) -o $@ $<
run: all
	@for v in $(ALL); do ./$$v; done
sweep:
	./run_sweep.sh
clean:
	rm -f $(ALL)
