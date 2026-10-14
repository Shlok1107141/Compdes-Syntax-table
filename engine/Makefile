CC ?= gcc
CFLAGS = -std=c11 -O2 -Wall -Wextra -Werror -pedantic
SANFLAGS = -std=c11 -g -Wall -Wextra -Werror -pedantic -fsanitize=address,undefined -fno-omit-frame-pointer

ALL = variant_a_bitpack variant_b_arena variant_c_trie \
      variant_ab_arena_bitpack variant_ac_trie_bitpack variant_bc_trie_arena \
      variant_abc_full

# The analyzer links every variant; SYMTAB_NO_MAIN drops their demo main()s.
ANALYZE_SRCS = symtab_analyze.c $(addsuffix .c,$(ALL))

all: $(ALL) symtab_analyze

variant_%: variant_%.c symtab_common.h
	$(CC) $(CFLAGS) -o $@ $<

symtab_analyze: $(ANALYZE_SRCS) symtab_common.h
	$(CC) $(CFLAGS) -DSYMTAB_NO_MAIN -o $@ $(ANALYZE_SRCS)

run: all
	@for v in $(ALL); do ./$$v; done

sweep:
	./run_sweep.sh

# Speed of the eight structures (insert / lookup hit / lookup miss, ns per op).
bench: symtab_bench.c symtab_common.h symtab_workloads.h $(addsuffix .c,$(ALL))
	$(CC) $(CFLAGS) -DSYMTAB_NO_MAIN -o symtab_bench symtab_bench.c $(addsuffix .c,$(ALL))
	./symtab_bench | tee bench_results.csv

syntax_bench: syntax_table_compress.c syntax_table.h
	$(CC) $(CFLAGS) -DSYNTAX_BENCH_CLI -o $@ syntax_table_compress.c -lm

# Testing standard: verify under sanitizers, then measure.
check:
	$(CC) $(SANFLAGS) -DSYMTAB_NO_MAIN -o symtab_analyze_san $(ANALYZE_SRCS)
	printf 'int counter; int counter_max;\n' | ./symtab_analyze_san > /dev/null
	@echo "sanitizer check: clean"

clean:
	rm -f $(ALL) symtab_analyze symtab_analyze_san symtab_bench syntax_bench syntax_bench.exe

.PHONY: all run sweep bench syntax_bench check clean
